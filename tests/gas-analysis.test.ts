import { describe, it, expect } from 'vitest';
import { analyzeContract, SIGNA_PER_STEP, API_STEP_MULTIPLIER } from '../lib/gas/analyzer.js';

// A minimal contract exercising the three cases the analyzer must get right:
//   - a switch dispatcher (method-code mapping)
//   - a data-dependent inner loop (loop cap)
//   - a branch with no loop (deterministic min == max)
const PROBE = `
#program name Probe
#pragma optimizationLevel 3
#pragma maxAuxVars 3

#define M_A 1
#define M_B 2

long counter;
struct TXINFO { long txId; long sender; long msg[4]; long amount; } cur;

void main() {
    while ((cur.txId = getNextTx()) != 0) {
        cur.sender = getSender(cur.txId);
        readMessage(cur.txId, 0, cur.msg);
        switch (cur.msg[0]) {
            case M_A: handleA(cur.msg[1]); break;
            case M_B: handleB(); break;
        }
    }
}

void handleA(long n) {
    long i = 0;
    while (i < n) {
        counter += i;
        ++i;
    }
}

void handleB() {
    if (cur.amount > 100) { counter = 1; } else { counter = 2; }
}
`;

describe('gas analyzer', () => {
    it('computes handler-body min/max steps with the default loop cap (N=10)', () => {
        const { handlers } = analyzeContract(PROBE);
        const a = handlers.find((h) => h.name === 'handleA')!;
        const b = handlers.find((h) => h.name === 'handleB')!;

        // handleA has no API calls, so steps == instructions:
        //   CLR + 10x(BLT+ADD+INC+JMP) + BLT+RET = 1 + 40 + 2 = 43
        expect(a.minSteps).toBe(3);
        expect(a.maxSteps).toBe(43);
        expect(a.capHit).toBe(true);

        // handleB: both branches are SET+BLE+SET+RET = 4 (no API calls, deterministic)
        expect(b.minSteps).toBe(4);
        expect(b.maxSteps).toBe(4);
        expect(b.capHit).toBe(false);
    });

    it('reports a single-pass (1×loop) estimate between Min and Max', () => {
        const a = analyzeContract(PROBE).handlers.find((h) => h.name === 'handleA')!;
        // handleA's loop: Min skips it (3), 1× runs it once, Max runs it 10× (43).
        // CLR + 1×(BLT+ADD+INC+JMP) + BLT+RET = 7 steps.
        expect(a.oneRunSteps).toBe(7);
        expect(a.minSteps).toBeLessThanOrEqual(a.oneRunSteps!);
        expect(a.oneRunSteps!).toBeLessThanOrEqual(a.maxSteps);
        expect(a.oneRunSigna).toBeCloseTo(0.007, 6);

        // handleB has no loop → all three collapse to the same value.
        const b = analyzeContract(PROBE).handlers.find((h) => h.name === 'handleB')!;
        expect(b.oneRunSteps).toBe(b.maxSteps);
    });

    it('scales the loop bound with --loop-cap', () => {
        const cap1 = analyzeContract(PROBE, { loopCap: 1 }).handlers.find((h) => h.name === 'handleA')!;
        // CLR + 1x(BLT+ADD+INC+JMP) + BLT+RET = 1 + 4 + 2 = 7
        expect(cap1.maxSteps).toBe(7);

        const cap5 = analyzeContract(PROBE, { loopCap: 5 }).handlers.find((h) => h.name === 'handleA')!;
        // CLR + 5x4 + 2 = 23
        expect(cap5.maxSteps).toBe(23);
    });

    it('maps method codes to handlers, charging API calls at 10 steps each', () => {
        const { methods } = analyzeContract(PROBE);
        const m1 = methods.find((m) => m.code === 1)!;
        const m2 = methods.find((m) => m.code === 2)!;

        expect(m1.handler).toBe('handleA');
        expect(m2.handler).toBe('handleB');

        // Preamble (cost to reach the case) has 7 API (FUN) calls = 70 steps, plus
        // CLR+SET+BEQ = 3 → 73. No data-dependent calls, so min == max.
        expect(m1.dispatchMin).toBe(73);
        expect(m1.dispatchMax).toBe(73);
        // Case body: SET + JSR + handleA[3..43] + JMP = 6..46 (no API calls).
        expect(m1.minSteps).toBe(79);   // 73 + 6
        expect(m1.maxSteps).toBe(119);  // 73 + 46

        // m2 reached after one extra failed compare (SET+BEQ = 2 more steps) → 75.
        expect(m2.dispatchMin).toBe(75);
        expect(m2.dispatchMax).toBe(75);
        expect(m2.minSteps).toBe(81);   // 75 + JSR+handleB(4)+JMP = 6
        expect(m2.maxSteps).toBe(81);
    });

    it('has no post-loop cost when main() ends at the tx loop', () => {
        // PROBE's while loop is the last thing in main() — nothing runs after it.
        expect(analyzeContract(PROBE).postLoop).toBeNull();
    });

    // Regression: main() with trailing effects AFTER the tx loop. The old
    // findBodyEntry only inspected the instruction before FIN; a post-loop call
    // there made it fall back to index 0, which (a) walked dispatch from the top
    // of the program, (b) multiplied the tx loop itself by the loop cap, and
    // (c) omitted the post-loop cost. Every handler then reported an identical,
    // absurd MAX far above the 100-SIGNA / 100k-step hard ceiling.
    const POST_LOOP = `
#program name PostLoop
#pragma optimizationLevel 3
#pragma maxAuxVars 3
#define M_A 1
#define M_B 2
long counter;
long total;
struct TXINFO { long txId; long sender; long msg[4]; long amount; } cur;
void main() {
    while ((cur.txId = getNextTx()) != 0) {
        cur.sender = getSender(cur.txId);
        readMessage(cur.txId, 0, cur.msg);
        switch (cur.msg[0]) {
            case M_A: handleA(cur.msg[1]); break;
            case M_B: handleB(); break;
        }
    }
    // Post-loop: runs once per activation after the queue drains.
    setMapValue(1, 1, total);
}
void handleA(long n) { total += n; }
void handleB() { total += 1; }
`;

    it('finds the tx loop when post-loop code sits between it and FIN', () => {
        const { methods, postLoop } = analyzeContract(POST_LOOP);
        const m = methods.find((x) => x.code === 1)!;

        expect(m.handler).toBe('handleA');
        // Preamble is the per-tx getSender/readMessage + one compare — a couple
        // hundred steps at most, NOT the whole-program walk (thousands) the bug
        // produced. Sanity-bound it well under the 100k-step ceiling.
        expect(m.dispatchMin).toBeLessThan(200);
        expect(m.maxSteps).toBeLessThan(300);

        // The trailing setMapValue() is charged once as post-loop, not folded
        // into every handler and not multiplied by the loop cap.
        expect(postLoop).not.toBeNull();
        expect(postLoop!.maxSteps).toBeGreaterThan(0);
        expect(postLoop!.capHit).toBe(false);
    });

    it('does not overflow the stack on a high loop cap over nested loops', () => {
        // A large --loop-cap makes the longest path deep enough to blow the JS
        // call stack; the depth guard must degrade to a flagged lower bound
        // instead of throwing "Maximum call stack size exceeded".
        const NESTED = `
#program name Nested
#pragma optimizationLevel 3
#pragma maxAuxVars 3
#define M_A 1
#define M_B 2
long counter;
struct TXINFO { long txId; long sender; long msg[4]; long amount; } cur;
void main() {
    while ((cur.txId = getNextTx()) != 0) {
        cur.sender = getSender(cur.txId);
        readMessage(cur.txId, 0, cur.msg);
        switch (cur.msg[0]) {
            case M_A: nested(cur.msg[1], cur.msg[2]); break;
            case M_B: counter += 1; break;
        }
    }
}
void nested(long a, long b) {
    long i = 0;
    while (i < a) { long j = 0; while (j < b) { counter += j; ++j; } ++i; }
}
`;
        expect(() => analyzeContract(NESTED, { loopCap: 200 })).not.toThrow();
        const m = analyzeContract(NESTED, { loopCap: 200 }).methods.find((x) => x.code === 1)!;
        expect(m.maxSteps).toBeGreaterThan(0);
        expect(Number.isFinite(m.maxSteps)).toBe(true);
    });

    it('exposes the verified fee model (0.001 SIGNA/step, API = 10 steps)', () => {
        expect(SIGNA_PER_STEP).toBe(0.001);
        expect(API_STEP_MULTIPLIER).toBe(10);
        const a = analyzeContract(PROBE).handlers.find((h) => h.name === 'handleA')!;
        expect(a.maxSigna).toBeCloseTo(0.043, 6);
    });
});

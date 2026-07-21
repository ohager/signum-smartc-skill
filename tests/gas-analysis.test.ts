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

        // Dispatch preamble has 7 API (FUN) calls = 70 steps, plus CLR+SET+BEQ = 3 → 73.
        expect(m1.dispatchSteps).toBe(73);
        // Case body: SET + JSR + handleA[3..43] + JMP = 6..46 (no API calls).
        expect(m1.minSteps).toBe(79);   // 73 + 6
        expect(m1.maxSteps).toBe(119);  // 73 + 46

        // m2 reached after one extra failed compare (SET+BEQ = 2 more steps) → 75.
        expect(m2.dispatchSteps).toBe(75);
        expect(m2.minSteps).toBe(81);   // 75 + JSR+handleB(4)+JMP = 6
        expect(m2.maxSteps).toBe(81);
    });

    it('exposes the verified fee model (0.001 SIGNA/step, API = 10 steps)', () => {
        expect(SIGNA_PER_STEP).toBe(0.001);
        expect(API_STEP_MULTIPLIER).toBe(10);
        const a = analyzeContract(PROBE).handlers.find((h) => h.name === 'handleA')!;
        expect(a.maxSigna).toBeCloseTo(0.043, 6);
    });
});

// Exact replica of the MSVC CRT rand()/srand() LCG the oracle's layout randomness runs on.
export const RAND_MAX = 0x7fff;

export class MsvcRand {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	srand(seed: number): void {
		this.state = seed >>> 0;
	}

	rand(): number {
		this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
		return (this.state >>> 16) & 0x7fff;
	}

	// Mirrors the oracle's randfloat(): ((double) rand()) / RAND_MAX
	randfloat(): number {
		return this.rand() / RAND_MAX;
	}
}

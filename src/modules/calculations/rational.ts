// Bounded exact arithmetic. Decimal inputs are data, never executable expressions.
export class Rational {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw new Error('ZERO_DENOMINATOR');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    let a = n < 0n ? -n : n,
      b = d;
    while (b) {
      const r = a % b;
      a = b;
      b = r;
    }
    this.n = n / (a || 1n);
    this.d = d / (a || 1n);
  }
  static parse(value: string): Rational {
    if (!/^-?\d{1,15}(?:\.\d{1,9})?$/.test(value)) throw new Error('INVALID_DECIMAL');
    const [whole, fraction = ''] = value.split('.');
    const sign = value.startsWith('-') ? -1n : 1n;
    return new Rational(
      sign * BigInt(whole!.replace('-', '') + fraction),
      10n ** BigInt(fraction.length),
    );
  }
  add(b: Rational): Rational {
    return new Rational(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(b: Rational): Rational {
    return new Rational(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(b: Rational): Rational {
    return new Rational(this.n * b.n, this.d * b.d);
  }
  div(b: Rational): Rational {
    return new Rational(this.n * b.d, this.d * b.n);
  }
  compare(b: Rational): number {
    const n = this.n * b.d - b.n * this.d;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  }
  ceil(): string {
    return (this.n / this.d + (this.n > 0n && this.n % this.d ? 1n : 0n)).toString();
  }
  decimal(places = 6): string {
    const scale = 10n ** BigInt(places),
      absolute = this.n < 0n ? -this.n : this.n;
    const scaled = (absolute * scale * 2n + this.d) / (this.d * 2n);
    const digits = scaled.toString().padStart(places + 1, '0');
    const value = places
      ? (digits.slice(0, -places) + '.' + digits.slice(-places)).replace(/\.?0+$/, '')
      : digits;
    return (this.n < 0n && scaled !== 0n ? '-' : '') + value;
  }
  exact(): { numerator: string; denominator: string } {
    return { numerator: this.n.toString(), denominator: this.d.toString() };
  }
}

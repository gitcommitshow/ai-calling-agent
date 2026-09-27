/**
 * Sinon 22 ships no types. This covers only the stub surface our Mocha tests
 * use, so typecheck does not depend on @types/sinon.
 */
declare module 'sinon' {
  export interface SinonStub {
    (...args: unknown[]): unknown;
    resolves(value?: unknown): SinonStub;
  }

  export interface SinonStatic {
    stub(): SinonStub;
    restore(): void;
  }

  const sinon: SinonStatic;
  export default sinon;
}

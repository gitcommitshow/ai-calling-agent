/**
 * Sinon 22 ships no types. This covers only the stub surface our Mocha tests
 * use, so typecheck does not depend on @types/sinon.
 */
declare module 'sinon' {
  export interface SinonStub {
    (...args: never[]): any;
    resolves(value?: unknown): SinonStub;
    callsFake(fn: (...args: any[]) => unknown): SinonStub;
    firstCall: { args: any[] };
    restore(): void;
    called: boolean;
  }

  export interface SinonStatic {
    stub(): SinonStub;
    stub(obj: object, method: PropertyKey): SinonStub;
    restore(): void;
  }

  const sinon: SinonStatic;
  export default sinon;
}

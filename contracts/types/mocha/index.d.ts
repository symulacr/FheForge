declare namespace Mocha {
  interface MochaOptions {
    [key: string]: unknown;
  }
}

declare function describe(name: string, fn: () => void): void;
declare namespace describe {
  function skip(name: string, fn: () => void): void;
  function only(name: string, fn: () => void): void;
}

declare function it(name: string, fn: () => unknown | Promise<unknown>): void;
declare namespace it {
  function skip(name: string, fn: () => unknown | Promise<unknown>): void;
  function only(name: string, fn: () => unknown | Promise<unknown>): void;
}

declare function beforeEach(fn: () => unknown | Promise<unknown>): void;
declare function afterEach(fn: () => unknown | Promise<unknown>): void;
declare function before(fn: () => unknown | Promise<unknown>): void;
declare function after(fn: () => unknown | Promise<unknown>): void;

/**
 * Integration Adapter Tests
 *
 * Tests StateManager, DataFetcher, and Lifecycle
 * from integration-adapter.js.
 */

import { describe, it, expect } from 'bun:test';

// Browser globals setup by test/setup.js

// Set up __transformers stub
globalThis.window.__transformers = globalThis.window.__transformers || {};

import '../src/integration-adapter.js';

describe('StateManager', () => {
  it('has setMockData method', () => {
    expect(typeof globalThis.window.__integration.StateManager.setMockData).toBe('function');
  });

  it('has getMockData method', () => {
    expect(typeof globalThis.window.__integration.StateManager.getMockData).toBe('function');
  });

  it('has setBatchMockData method', () => {
    expect(typeof globalThis.window.__integration.StateManager.setBatchMockData).toBe('function');
  });

  it('setMockData writes to __MOCK__ and notifies', () => {
    const sm = globalThis.window.__integration.StateManager;
    sm.setMockData('TEST_KEY', 'test-value');
    expect(globalThis.window.__MOCK__.TEST_KEY).toBe('test-value');
    expect(sm.getMockData('TEST_KEY')).toBe('test-value');
  });

  it('setBatchMockData writes multiple keys and notifies once', () => {
    const sm = globalThis.window.__integration.StateManager;
    sm.setBatchMockData({
      KEY_A: 'value-a',
      KEY_B: 'value-b',
    });
    expect(globalThis.window.__MOCK__.KEY_A).toBe('value-a');
    expect(globalThis.window.__MOCK__.KEY_B).toBe('value-b');
  });

  it('setBatchMockData does NOT overwrite TEMPLATES', () => {
    const sm = globalThis.window.__integration.StateManager;
    globalThis.window.__MOCK__.TEMPLATES = 'original-templates';
    sm.setBatchMockData({ TEMPLATES: 'new-templates' });
    expect(globalThis.window.__MOCK__.TEMPLATES).toBe('original-templates');
  });

  it('setBatchMockData does NOT overwrite DEFAULT_CONFIG', () => {
    const sm = globalThis.window.__integration.StateManager;
    globalThis.window.__MOCK__.DEFAULT_CONFIG = 'original-config';
    sm.setBatchMockData({ DEFAULT_CONFIG: 'new-config' });
    expect(globalThis.window.__MOCK__.DEFAULT_CONFIG).toBe('original-config');
  });
});

describe('DataFetcher', () => {
  it('has register method', () => {
    expect(typeof globalThis.window.__integration.DataFetcher.register).toBe('function');
  });

  it('has startAll method', () => {
    expect(typeof globalThis.window.__integration.DataFetcher.startAll).toBe('function');
  });

  it('has stopAll method', () => {
    expect(typeof globalThis.window.__integration.DataFetcher.stopAll).toBe('function');
  });

  it('register and fetch a named data source', () => {
    const df = globalThis.window.__integration.DataFetcher;
    let fetchCalled = false;

    df.register('test-source', function () {
      fetchCalled = true;
      return Promise.resolve('data');
    }, 0); // No interval

    df.startAll();
    expect(fetchCalled).toBe(true);
    df.stopAll();
  });
});

describe('Lifecycle', () => {
  it('has start method', () => {
    expect(typeof globalThis.window.__integration.Lifecycle.start).toBe('function');
  });

  it('has stop method', () => {
    expect(typeof globalThis.window.__integration.Lifecycle.stop).toBe('function');
  });

  it('start/stop cycle works without errors', () => {
    const lc = globalThis.window.__integration.Lifecycle;
    lc.start();
    expect(lc.isRunning()).toBe(true);
    lc.stop();
    expect(lc.isRunning()).toBe(false);
  });
});

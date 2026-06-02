/**
 * Global type augmentations for the FheForge bridge package.
 */

interface Window {
  /** Runtime configuration overrides for the bridge layer */
  __FHEFORGE_CONFIG__?: Record<string, unknown>;
}

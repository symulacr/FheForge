# ESLint v9 Migration Plan

## Current State

- **ESLint Version**: v8 (`"eslint": "^8"`)
- **Configuration Format**: `.eslintrc.json` (legacy eslintrc format)
- **Extended Configs**: `next/core-web-vitals`, `next/typescript`
- **Custom Rules**: `@typescript-eslint/no-unused-vars` with ignore patterns
- **Overrides**: Disabled `react-hooks/exhaustive-deps` for `components/effect/*.tsx`

## Target State

- **ESLint Version**: v9
- **Configuration Format**: `eslint.config.js` or `eslint.config.mjs` (flat config)
- **Extended Configs**: Migrated to flat config equivalents
- **TypeScript Support**: `@typescript-eslint` v8+ (compatible with ESLint v9)

## Key Changes Required

### 1. Flat Config Format

ESLint v9 uses the new flat config format instead of `.eslintrc.json`. The configuration becomes a JavaScript/TypeScript file exporting an array of config objects.

**Before (`.eslintrc.json`)**:
```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": { ... }
}
```

**After (`eslint.config.mjs`)**:
```js
import nextPlugin from '@next/eslint-plugin-next';
import typescriptEslint from 'typescript-eslint';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default typescriptEslint.config(
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Will need flat-config compatible Next.js configs
    ],
    rules: { ... }
  }
);
```

### 2. Plugin Compatibility

- `eslint-config-next`: Must use version compatible with ESLint v9 (Next.js 15+ or standalone `@next/eslint-plugin-next`)
- `@typescript-eslint`: Upgrade to v8+ which supports ESLint v9 flat config
- `eslint-plugin-react-hooks`: Ensure v5+ for flat config support

### 3. Configuration Structure Changes

| Legacy (v8) | Flat Config (v9) |
|-------------|------------------|
| `extends` | Import and spread config arrays |
| `plugins` | Direct imports |
| `overrides` | Multiple config objects with `files` property |
| `parser` | Use `typescript-eslint.parser` via config |
| `parserOptions` | Part of languageOptions |

### 4. New Config API

- `languageOptions` replaces `parserOptions`
- `linterOptions` for settings like `reportUnusedDisableDirectives`
- Plugins are imported directly, not referenced by string

## Step-by-Step Migration Plan

### Phase 1: Preparation (1-2 hours)

1. **Audit current setup**
   - Document all ESLint plugins and configs in use
   - Check for deprecated rules

2. **Update dependencies**
   ```bash
   npm install -D eslint@^9 @typescript-eslint/eslint-plugin@^8 @typescript-eslint/parser@^8
   ```

3. **Check Next.js compatibility**
   - Verify `eslint-config-next` supports ESLint v9
   - If not, use `@next/eslint-plugin-next` directly

### Phase 2: Configuration Migration (2-3 hours)

1. **Create `eslint.config.mjs`**
   - Convert `.eslintrc.json` to flat config format
   - Import plugins directly

2. **Migrate extends**
   - Replace `next/core-web-vitals` with flat config equivalent
   - Replace `next/typescript` with typescript-eslint config

3. **Migrate rules**
   - Copy custom rules to new format
   - Update any deprecated rule names

4. **Migrate overrides**
   - Convert to separate config object with `files` property

### Phase 3: Testing & Validation (1-2 hours)

1. **Run ESLint**
   ```bash
   npm run lint
   ```

2. **Fix any configuration errors**
   - Address plugin compatibility issues
   - Update rule configurations as needed

3. **Update package.json scripts**
   - Ensure `lint` script works with new config

### Phase 4: Cleanup (30 minutes)

1. **Remove old config**
   - Delete `.eslintrc.json` after verification

2. **Update documentation**
   - Update README with new ESLint setup

3. **Commit changes**
   - Include migration notes in commit message

## Estimated Effort

| Phase | Time |
|-------|------|
| Preparation | 1-2 hours |
| Configuration Migration | 2-3 hours |
| Testing & Validation | 1-2 hours |
| Cleanup | 30 minutes |
| **Total** | **4.5-7.5 hours** |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `eslint-config-next` incompatibility | Use `@next/eslint-plugin-next` directly |
| Plugin breaking changes | Test each plugin individually |
| Rule deprecations | Review ESLint v9 changelog for deprecated rules |
| CI/CD failures | Run full test suite after migration |

## References

- [ESLint v9 Migration Guide](https://eslint.org/docs/latest/use/migrate-to-9.0.0)
- [Flat Config Documentation](https://eslint.org/docs/latest/use/configure/configuration-files-new)
- [typescript-eslint v8 Release](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/)

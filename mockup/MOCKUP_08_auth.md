# MOCKUP 08 — Wallet Authentication (Nonce→Sign→JWT)

**Source**: `backend/apps/src/auth/`
**Files**: `auth.service.ts`, `auth.controller.ts`, `dto/wallet-login.dto.ts`,
`jwt.strategy.ts`, `jwt-auth.guard.ts`, `auth.module.ts`, `public.decorator.ts`

---

## Flow

```
GET /auth/nonce/:walletAddress
  → generateNonce() → stores UUID + expiry in `auth_nonces` table
  → returns { nonce, message }

POST /auth/wallet-login
  Body: { walletAddress, signature, nonce, chainId? }
  → login() → validates nonce (exists, match, not expired)
  → verifyMessage() → recovers address from EIP-191 signature
  → consumes nonce (DELETE from auth_nonces)
  → findOrCreate user in users table
  → signs JWT (sub, walletAddress, role)
  → returns { accessToken, userId, walletAddress }
```

## Auth Service (`auth.service.ts`)

### `generateNonce(walletAddress: string)`
- Normalises address to lowercase.
- Generates UUID v4 nonce, sets `expires_at` = now + 5 min.
- Upserts into `auth_nonces` keyed by `wallet_address` — one nonce per wallet at a time.
- Builds EIP-191 message via `buildAuthMessage()`.
- Returns `{ nonce, message }`.

### `login(walletAddress, signature, nonce, chainId?)`
1. **Nonce lookup**: fetches `auth_nonces` row by `wallet_address`. Throws `401` if missing.
2. **Nonce match**: compares stored nonce against provided nonce. Throws `401` if mismatch.
3. **Nonce expiry**: checks `expires_at` against current time. Deletes expired nonce, throws `401`.
4. **Signature verification**: reconstructs the auth message, calls `ethers.verifyMessage()` (EIP-191). Throws `401` on invalid signature format.
5. **Address recovery**: compares `recoveredAddress.toLowerCase()` against `normalizedAddress`. If mismatch, deletes nonce, throws `401`.
6. **Nonce consumption**: deletes the nonce row (replay prevention).
7. **User find or create**: looks up user by wallet address via `UserService.getUserByWalletAddress()`. If not found, creates with `UserService.createUser({ walletAddress, chainId })`. Default chain ID 421614 (Arbitrum Sepolia).
8. **JWT signing**: issues token with `sub: user.id`, `walletAddress`, `role: 'user'`. Expiry 15m (set in module config).
9. Logs success, returns `{ accessToken, userId, walletAddress }`.

### `buildAuthMessage()`
```
FheForge Authentication
Wallet: 0x…
Nonce: <uuid>
```

Simple plaintext, signed via `ethers.verifyMessage()` (EIP-191).

## Auth Controller (`auth.controller.ts`)

- Decorated `@ApiTags('Authentication')`, base path `/auth`.
- Both endpoints marked `@Public()` — bypass JWT guard.

| Endpoint | Method | Decorators | Body/Params | Returns |
|---|---|---|---|---|
| `/auth/nonce/:walletAddress` | `GET` | `@Public()`, Swagger | Param: `walletAddress` | `NonceResponseDto` |
| `/auth/wallet-login` | `POST` | `@Public()`, `@HttpCode(200)`, Swagger | Body: `WalletLoginDto` | `WalletLoginResponseDto` |

## DTOs (`dto/wallet-login.dto.ts`)

| DTO | Fields |
|---|---|
| `WalletLoginDto` | `walletAddress` (EthereumAddress), `signature`, `nonce`, `chainId?` (int ≥1) |
| `WalletLoginResponseDto` | `accessToken`, `userId`, `walletAddress` |
| `NonceResponseDto` | `nonce`, `message` |

Validation via `class-validator`: `@IsEthereumAddress()`, `@IsString()`, `@IsOptional()`, `@IsInt()`, `@Min(1)`.

## JWT Strategy (`jwt.strategy.ts`)

- `passport-jwt` strategy, extracts from `Authorization: Bearer <token>` header.
- Algorithm restricted to `HS256`.
- Reads `JWT_SECRET` from env — throws on boot if missing.
- `validate()` returns `{ userId, email?, role? }` from decoded payload.

## JWT Auth Guard (`jwt-auth.guard.ts`)

- Extends Passport `AuthGuard('jwt')`.
- Checks `@Public()` decorator via Reflector — skips auth if present.
- Used as a global guard (registered via the module's provider exports).

## Auth Module (`auth.module.ts`)

- Imports: `PassportModule` (default strategy: `'jwt'`), `JwtModule` (async, reads `JWT_SECRET`, 15m expiry), `SupabaseModule`, `UsersModule`.
- Providers: `AuthService`, `JwtStrategy`, `JwtAuthGuard`.
- Exports: the module itself, `JwtModule`, `JwtAuthGuard`, `AuthService`.
- Per-module check: `JWT_SECRET` required at module init (logs + throws if missing).

## Key Observations

- **Single nonce per wallet**: upsert replaces any existing nonce, so only one auth attempt can be in flight per wallet. No nonce queue or multi-session nonce support.
- **Nonce consumed after each attempt** (success or signature mismatch). Expired nonces also cleaned up on access. Replay-safe by design.
- **User auto-creation**: first-time login creates a user record with the wallet address and chain ID. No email/username pre-registration needed.
- **Default chain 421614** (Arbitrum Sepolia testnet). Mainnet overridable via `chainId` field.
- **Only wallet address identity** — no email, no username. The JWT payload carries `sub` (user.id), `walletAddress`, and `role: 'user'`.
- **Signature verification via ethers v6** `verifyMessage()` — handles EIP-191 prefixing automatically. The `buildAuthMessage()` just returns the plaintext; ethers prepends `\x19Ethereum Signed Message:\n${len}`.
- **No refresh token mechanism** — JWT expires in 15m, client must re-authenticate or the frontend would need to detect expiry and prompt re-login.
- **Swagger docs** wired up via `@nestjs/swagger` decorators on both controller and DTO classes.

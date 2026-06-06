# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | ✅                |
| 1.0.x   | ✅                |
| < 1.0   | ❌                |

## Reporting a Vulnerability

We take the security of FheForge seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report via email to the project maintainer at the address listed in the README.

You should receive a response within 48 hours. If for some reason you do not, please follow up via the same channel.

We ask that you:

- Provide a clear description of the vulnerability
- Include steps to reproduce the issue
- Share any proof-of-concept code if available

## Disclosure Policy

When we receive a security report, we will:

1. Confirm receipt within 48 hours
2. Investigate and validate the report
3. Work on a fix
4. Release a security advisory and updated version

## Responsible Disclosure

We kindly request that you:

- Give us reasonable time to investigate and fix the issue before public disclosure
- Make every effort to avoid privacy violations, data destruction, and service interruption
- Do not exploit the vulnerability beyond what is necessary to demonstrate the issue

## Audit Status

FheForge has not yet undergone a formal third-party security audit. The protocol includes:
- Custom 2-step ownership transfer (FheForgeBase)
- FHE-specific access control (CoFHE ACL)
- ZK verifier integration for ciphertext validation

All smart contracts are provided as-is for the Akindo Wave Hacks buildathon. Use at your own risk.

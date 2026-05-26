"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { parseUnits, formatUnits } from "viem";
import { useCofheClient, useCofheState } from "@/providers/fhenix-provider";
import type { EncryptedUint128Input } from "@/hooks/use-fhe-vault";

function truncateHash(hash: bigint, start = 6, end = 6): string {
  const hex = "0x" + hash.toString(16);
  if (hex.length <= start + end + 2) return hex;
  return `${hex.slice(0, start + 2)}...${hex.slice(-end)}`;
}

export function FheDemoWidget() {
  const { address } = useAccount();
  const cofheClient = useCofheClient();
  const cofheState = useCofheState();

  const [inputValue, setInputValue] = useState("");
  const [encryptedHandle, setEncryptedHandle] =
    useState<EncryptedUint128Input | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<string | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReady = cofheState.isReady && cofheState.permitReady;

  const handleEncrypt = useCallback(async () => {
    if (!inputValue || isNaN(Number(inputValue))) {
      setError("Enter a valid number");
      return;
    }
    if (!cofheClient) {
      setError("CoFHE client not initialized");
      return;
    }

    setError(null);
    setEncryptedHandle(null);
    setDecryptedValue(null);
    setIsEncrypting(true);

    try {
      const value = parseUnits(inputValue, 18);
      const handles = (await cofheClient
        .encryptInputs([Encryptable.uint128(value)])
        .execute()) as EncryptedUint128Input[];

      if (!handles[0]) {
        throw new Error("CoFHE returned empty handle list");
      }

      setEncryptedHandle(handles[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Encryption failed";
      setError(message);
    } finally {
      setIsEncrypting(false);
    }
  }, [inputValue, cofheClient]);

  const handleDecrypt = useCallback(async () => {
    if (!encryptedHandle) {
      setError("No encrypted value to decrypt");
      return;
    }
    if (!cofheClient) {
      setError("CoFHE client not initialized");
      return;
    }

    setError(null);
    setIsDecrypting(true);

    try {
      const result = await (
        cofheClient as {
          decryptForView: (
            hash: bigint,
            fheType: typeof FheTypes.Uint128,
          ) => { execute: () => Promise<bigint> };
        }
      )
        .decryptForView(encryptedHandle.ctHash, FheTypes.Uint128)
        .execute();

      const formatted = formatUnits(result, 18);
      setDecryptedValue(formatted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Decryption failed";
      setError(message);
    } finally {
      setIsDecrypting(false);
    }
  }, [encryptedHandle, cofheClient]);

  if (!address) {
    return (
      <div className="forge-card p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">
          FHE Encryption Demo
        </h3>
        <p className="text-xs text-muted">
          Connect wallet to try FHE encryption.
        </p>
      </div>
    );
  }

  return (
    <div className="forge-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">
          FHE Encryption Demo
        </h3>
        {isReady ? (
          <span className="text-[10px] uppercase tracking-wider text-success border border-success/30 px-2 py-0.5">
            Ready
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-warning border border-warning/30 px-2 py-0.5">
            Connecting...
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="number"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter a number..."
          disabled={isEncrypting || isDecrypting}
          className="flex-1 bg-input border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          onClick={handleEncrypt}
          disabled={!isReady || isEncrypting || !inputValue}
          className="terminal-btn primary shrink-0"
        >
          {isEncrypting ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-accent/40 border-t-accent animate-spin" />
              Encrypting...
            </span>
          ) : (
            "Encrypt"
          )}
        </button>
      </div>

      {encryptedHandle && (
        <div className="mb-4 p-3 bg-secondary border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
            Encrypted Handle
          </div>
          <div className="flex items-center justify-between gap-3">
            <code className="text-xs text-accent break-all">
              {truncateHash(encryptedHandle.ctHash)}
            </code>
            <button
              onClick={handleDecrypt}
              disabled={!isReady || isDecrypting}
              className="terminal-btn shrink-0"
            >
              {isDecrypting ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-accent/40 border-t-accent animate-spin" />
                  Decrypting...
                </span>
              ) : (
                "Decrypt"
              )}
            </button>
          </div>
        </div>
      )}

      {decryptedValue !== null && (
        <div className="p-3 bg-secondary border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
            Decrypted Value
          </div>
          <div className="text-sm text-success font-mono">{decryptedValue}</div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}

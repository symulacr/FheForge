var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/config.js
var DEFAULT_CONFIG = (() => {
  const config = {
    apiBaseUrl: "https://fheforge-api-production-6465.up.railway.app",
    chainId: 421614,
    rpcUrl: "https://sepolia-arbitrum-rpc.publicnode.com",
    walletConnectProjectId: undefined
  };
  if (typeof window !== "undefined" && window.__FHEFORGE_CONFIG__) {
    Object.assign(config, window.__FHEFORGE_CONFIG__);
  }
  return config;
})();
function createConfig(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides };
}
// src/api.js
import axios from "axios";

// src/types.js
class BridgeError extends Error {
  constructor(code, message, source, recoverable) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.source = source;
    this.recoverable = recoverable;
  }
}

class WalletError extends BridgeError {
  constructor(code, message, recoverable = true) {
    super(code, message, "wallet", recoverable);
    this.name = "WalletError";
  }
}

class ApiError extends BridgeError {
  constructor(code, message, statusCode, recoverable = false) {
    super(code, message, "api", recoverable);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

class ContractError extends BridgeError {
  constructor(code, message, recoverable = false) {
    super(code, message, "contract", recoverable);
    this.name = "ContractError";
  }
}

class FheError extends BridgeError {
  constructor(code, message, recoverable = true) {
    super(code, message, "cofhe", recoverable);
    this.name = "FheError";
  }
}

// src/api.js
class LRUCache {
  maxSize;
  #cache;
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.#cache = new Map;
  }
  get(key) {
    const entry = this.#cache.get(key);
    if (!entry)
      return { hit: false };
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    if (Date.now() < entry.expiry) {
      return { hit: true, value: entry.value, expired: false };
    }
    return { hit: true, value: entry.value, expired: true };
  }
  set(key, value, ttlMs) {
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    } else if (this.#cache.size >= this.maxSize) {
      const firstKey = this.#cache.keys().next().value;
      if (firstKey !== undefined)
        this.#cache.delete(firstKey);
    }
    this.#cache.set(key, {
      value,
      expiry: Date.now() + ttlMs
    });
  }
  has(key) {
    return this.#cache.has(key);
  }
  delete(key) {
    this.#cache.delete(key);
  }
  clear() {
    this.#cache.clear();
  }
}
var ENDPOINT_TTL = {
  markets: 30,
  "markets/prices": 30,
  stats: 30,
  activities: 15
};
var DEFAULT_TTL_SECONDS = 60;
function createApiAdapter(config, walletAdapter) {
  const baseURL = config.apiBaseUrl;
  const cache = new LRUCache(200);
  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
    withCredentials: true
  });
  client.interceptors.request.use((requestConfig) => {
    return requestConfig;
  }, (error) => Promise.reject(error));
  let isRefreshing = false;
  let failedQueue = [];
  function processQueue(error, token) {
    for (const { resolve, reject } of failedQueue) {
      if (error) {
        reject(error);
      } else {
        resolve(token);
      }
    }
    failedQueue = [];
  }
  client.interceptors.response.use((response) => response, async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry && walletAdapter && typeof walletAdapter.refreshJwt === "function") {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          return client(originalRequest);
        });
      }
      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const result = await walletAdapter.refreshJwt();
        processQueue(null, null);
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        try {
          var g = typeof window !== "undefined" ? window : globalThis;
          if (g.__bridgeBus) {
            g.__bridgeBus.set("error:auth", { message: "JWT refresh failed — session expired", timestamp: new Date().toISOString() });
          }
        } catch (_) {}
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  });
  function resolveTtl(urlPath) {
    const cleanPath = urlPath.replace(/^\//, "");
    for (const [prefix, ttl] of Object.entries(ENDPOINT_TTL)) {
      if (cleanPath === prefix || cleanPath.startsWith(`${prefix}/`) || cleanPath.startsWith(`${prefix}?`)) {
        return ttl * 1000;
      }
    }
    return DEFAULT_TTL_SECONDS * 1000;
  }
  function normalizeError(error) {
    if (error instanceof ApiError) {
      return { status: "error", data: null, error };
    }
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const serverMessage = error.response?.data?.message || error.response?.data?.error || "";
      const message = serverMessage || error.message || "Unknown API error";
      const recoverable = statusCode ? statusCode < 500 : false;
      const apiError2 = new ApiError(`HTTP_${statusCode || "ERROR"}`, message, statusCode, recoverable);
      return { status: "error", data: null, error: apiError2 };
    }
    const err = error;
    const apiError = new ApiError("UNKNOWN_ERROR", err.message || "An unknown error occurred", undefined, false);
    return { status: "error", data: null, error: apiError };
  }
  async function cachedGet(cacheKey, url, params = {}) {
    const cached = cache.get(cacheKey);
    if (cached.hit && !cached.expired) {
      return { status: "success", data: cached.value, error: null };
    }
    if (cached.hit && cached.expired) {
      fetchAndCache(cacheKey, url, params).catch(() => {});
      return { status: "success", data: cached.value, error: null };
    }
    return fetchAndCache(cacheKey, url, params);
  }
  async function fetchAndCache(cacheKey, url, params = {}) {
    try {
      const response = await client.get(url, { params });
      const data = response.data;
      const ttl = resolveTtl(url);
      cache.set(cacheKey, data, ttl);
      return { status: "success", data, error: null };
    } catch (error) {
      return normalizeError(error);
    }
  }
  async function get(url, params = {}) {
    try {
      const response = await client.get(url, { params });
      return { status: "success", data: response.data, error: null };
    } catch (error) {
      return normalizeError(error);
    }
  }
  async function post(url, body) {
    try {
      const response = await client.post(url, body);
      return { status: "success", data: response.data, error: null };
    } catch (error) {
      return normalizeError(error);
    }
  }
  return {
    system: {
      getReady: () => get("/ready"),
      getReadiness: () => get("/ready")
    },
    markets: {
      getMarkets: (params) => cachedGet("markets", "/markets", params),
      getPrices: () => cachedGet("markets-prices", "/markets/prices"),
      getStatus: () => get("/markets/status")
    },
    stats: {
      getStats: () => cachedGet("stats", "/stats")
    },
    strategies: {
      listStrategies: (params) => cachedGet("strategies-list", "/strategies", params)
    },
    governance: {
      listProposals: (params) => cachedGet("governance-proposals", "/governance/proposals", params),
      castVote: (data) => post("/governance/vote", data)
    },
    activities: {
      getActivities: (params) => cachedGet("activities", "/activities", params)
    },
    defiModules: {
      getDefiModules: () => cachedGet("defi-modules", "/defi-modules")
    },
    defiStrategies: {
      getDefiStrategies: (params) => cachedGet("defi-strategies", "/defi-strategies", params),
      createDefiStrategy: (data) => post("/defi-strategies", data),
      simulateDefiStrategy: (data) => post("/defi-strategies/simulate", data)
    },
    aiBuilder: {
      buildStrategy: (data) => post("/ai-strategy-builder/build", data)
    }
  };
}

// src/contract.js
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

// src/abis.js
var CONTRACT_ABIS = {
  LendingPool: [
    {
      type: "constructor",
      inputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "receive",
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "COMMIT_DEADLINE",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "FLASH_FEE_BPS",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "LIQUIDATION_BONUS_BPS",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint16",
          internalType: "uint16"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "LIQUIDATION_CLOSE_FACTOR_BPS",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint16",
          internalType: "uint16"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "REVEAL_COOLDOWN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "borrowFor",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "handle",
          type: "bytes32",
          internalType: "euint128"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "borrowWithLtvCheck",
      inputs: [
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "borrowToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "borrowAmount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encBorrowAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "ltvNum",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "ltvDen",
          type: "uint128",
          internalType: "uint128"
        }
      ],
      outputs: [
        {
          name: "actual",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "borrowWithOracle",
      inputs: [
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "borrowToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "collateralAmount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "borrowAmount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encBorrowAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [
        {
          name: "actual",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "commitBorrow",
      inputs: [
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "borrowToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "encBorrowAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "ltvNum",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "ltvDen",
          type: "uint128",
          internalType: "uint128"
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "depositFor",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "handle",
          type: "bytes32",
          internalType: "euint128"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "disableOracle",
      inputs: [],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "disableWeth",
      inputs: [],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeBorrow",
      inputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [
        {
          name: "actual",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeRepay",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeShield",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeShieldEth",
      inputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeWithdraw",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "executeWithdrawEth",
      inputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "flashFee",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "fee",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "flashLoan",
      inputs: [
        {
          name: "receiver",
          type: "address",
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "params",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [
        {
          name: "success",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "getBorrowBalance",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "bal",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "getSupplyBalance",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "bal",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "isComposer",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isLiquidatable",
      inputs: [
        {
          name: "user",
          type: "address",
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "debtToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "collateralAmount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "borrowAmount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "liquidatable",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "lastRevealTime",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        },
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "liquidReserve",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "liquidateWithProof",
      inputs: [
        {
          name: "user",
          type: "address",
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "debtToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "debtToCover",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "debtBalanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "debtSig",
          type: "bytes",
          internalType: "bytes"
        },
        {
          name: "supplyBalanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "supplySig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "maxFlashLoan",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "maxLoan",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "oracle",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract PriceOracle"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "partialUnshield",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "partialUnshieldEth",
      inputs: [
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "repay",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "repayDebt",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "repayFor",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "handle",
          type: "bytes32",
          internalType: "euint128"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "requestBalanceReveal",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "requestBorrowReveal",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "requestUnshield",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "setComposer",
      inputs: [
        {
          name: "c",
          type: "address",
          internalType: "address"
        },
        {
          name: "enabled",
          type: "bool",
          internalType: "bool"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "setOracle",
      inputs: [
        {
          name: "newOracle",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "setWeth",
      inputs: [
        {
          name: "newWeth",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "shield",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "shield",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "shieldEth",
      inputs: [
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "shieldEth",
      inputs: [
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "",
          type: "bool",
          internalType: "bool"
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "totalPlainBorrow",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unshieldWithProof",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "weth",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract IWETH9"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "withdraw",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "withdrawEth",
      inputs: [
        {
          name: "encAmount",
          type: "tuple",
          internalType: "struct InEuint128",
          components: [
            {
              name: "ctHash",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "securityZone",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "utype",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "signature",
              type: "bytes",
              internalType: "bytes"
            }
          ]
        },
        {
          name: "",
          type: "bool",
          internalType: "bool"
        }
      ],
      outputs: [
        {
          name: "commitId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "payable"
    },
    {
      type: "function",
      name: "withdrawPausedWithProof",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "balanceProof",
          type: "uint128",
          internalType: "uint128"
        },
        {
          name: "balanceSig",
          type: "bytes",
          internalType: "bytes"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "event",
      name: "BorrowCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "borrowToken",
          type: "address",
          indexed: false,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Borrowed",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "borrowToken",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "ComposerSet",
      inputs: [
        {
          name: "composer",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "FlashLoan",
      inputs: [
        {
          name: "receiver",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        },
        {
          name: "fee",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Liquidated",
      inputs: [
        {
          name: "liquidator",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "debtToken",
          type: "address",
          indexed: false,
          internalType: "address"
        },
        {
          name: "debtCovered",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        },
        {
          name: "collateralSeized",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OracleDisabled",
      inputs: [],
      anonymous: false
    },
    {
      type: "event",
      name: "OracleSet",
      inputs: [
        {
          name: "oracle",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PausedWithdrawn",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Repaid",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "RepayCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "ShieldCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "ShieldEthCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Supplied",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "UnshieldRequested",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "WethDisabled",
      inputs: [],
      anonymous: false
    },
    {
      type: "event",
      name: "WethSet",
      inputs: [
        {
          name: "weth",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "WithdrawCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "WithdrawEthCommitted",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "commitId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Withdrawn",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "CannotSelfLiquidate",
      inputs: []
    },
    {
      type: "error",
      name: "CommitmentExpired",
      inputs: []
    },
    {
      type: "error",
      name: "CommitmentNotFound",
      inputs: []
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "FlashLoanNotRepaid",
      inputs: []
    },
    {
      type: "error",
      name: "FlashLoanUnsupportedToken",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InsufficientCollateral",
      inputs: []
    },
    {
      type: "error",
      name: "InsufficientReserve",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidEncryptedInput",
      inputs: [
        {
          name: "got",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "expected",
          type: "uint8",
          internalType: "uint8"
        }
      ]
    },
    {
      type: "error",
      name: "InvalidProof",
      inputs: []
    },
    {
      type: "error",
      name: "LiquidationTooLarge",
      inputs: []
    },
    {
      type: "error",
      name: "LtvDenominatorZero",
      inputs: []
    },
    {
      type: "error",
      name: "LtvExceedsHundredPercent",
      inputs: []
    },
    {
      type: "error",
      name: "LtvNumeratorZero",
      inputs: []
    },
    {
      type: "error",
      name: "NotAuthorized",
      inputs: []
    },
    {
      type: "error",
      name: "NotComposer",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "OracleNotSet",
      inputs: []
    },
    {
      type: "error",
      name: "RevealCooldown",
      inputs: []
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "ValueMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "WethNotSet",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    }
  ],
  StrategyVault: [
    {
      type: "constructor",
      inputs: [
        {
          name: "registry_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "REGISTRY",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "addCollateral",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "collateralToken",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "bytes32",
          internalType: "euint128"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "closePosition",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "collateralAmount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encCollateralAmount",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "getCollateral",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "coll",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "getDepositedAmount",
      inputs: [
        {
          name: "",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "pure"
    },
    {
      type: "function",
      name: "getPositionMeta",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "createdAt",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getUserPositions",
      inputs: [
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "ids",
          type: "bytes32[]",
          internalType: "bytes32[]"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "openPosition",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "encAmount",
          type: "bytes32",
          internalType: "euint128"
        },
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "positionOwner",
      inputs: [
        {
          name: "",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "withdrawPaused",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "CollateralAdded",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PausedWithdrawn",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PositionClosed",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "fullClose",
          type: "bool",
          indexed: false,
          internalType: "bool"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PositionOpened",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "collateralToken",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "strategyId",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "ExceedsDeposit",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidStrategyId",
      inputs: []
    },
    {
      type: "error",
      name: "NoPosition",
      inputs: []
    },
    {
      type: "error",
      name: "NotPositionOwner",
      inputs: [
        {
          name: "positionId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "caller",
          type: "address",
          internalType: "address"
        },
        {
          name: "owner",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "PositionNotFound",
      inputs: []
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SameBlockClose",
      inputs: []
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    }
  ],
  Composer: [
    {
      type: "constructor",
      inputs: [
        {
          name: "registry_",
          type: "address",
          internalType: "address"
        },
        {
          name: "vault_",
          type: "address",
          internalType: "address"
        },
        {
          name: "pool_",
          type: "address",
          internalType: "address"
        },
        {
          name: "router_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "POOL",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract ILendingPool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "REGISTRY",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract IRegistry"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "ROUTER",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract ISwapRouter"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "VAULT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract IStrategyVault"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "openPosition",
      inputs: [
        {
          name: "p",
          type: "tuple",
          internalType: "struct FheForgeComposer.OpenStrategyParams",
          components: [
            {
              name: "strategyName",
              type: "string",
              internalType: "string"
            },
            {
              name: "workflowHash",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "collateralAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "poolSupplyAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "poolBorrowAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "swapDeadlineOffset",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "strategyId",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "swapAmountIn",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "swapMinOut",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "collateralToken",
              type: "address",
              internalType: "address"
            },
            {
              name: "borrowToken",
              type: "address",
              internalType: "address"
            },
            {
              name: "swapTokenOut",
              type: "address",
              internalType: "address"
            },
            {
              name: "apyTarget",
              type: "uint16",
              internalType: "uint16"
            },
            {
              name: "loopCount",
              type: "uint8",
              internalType: "uint8"
            }
          ]
        },
        {
          name: "e",
          type: "tuple",
          internalType: "struct FheForgeComposer.OpenStrategyEncrypted",
          components: [
            {
              name: "collateral",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            },
            {
              name: "supplyEnc",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            },
            {
              name: "borrowEnc",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            }
          ]
        }
      ],
      outputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "rebalance",
      inputs: [
        {
          name: "p",
          type: "tuple",
          internalType: "struct FheForgeComposer.RebalanceParams",
          components: [
            {
              name: "positionId",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "collateralToken",
              type: "address",
              internalType: "address"
            },
            {
              name: "addCollateralAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "repayAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "repayToken",
              type: "address",
              internalType: "address"
            },
            {
              name: "newBorrowAmount",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "borrowToken",
              type: "address",
              internalType: "address"
            }
          ]
        },
        {
          name: "e",
          type: "tuple",
          internalType: "struct FheForgeComposer.RebalanceEncrypted",
          components: [
            {
              name: "addCollateralEnc",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            },
            {
              name: "repayEnc",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            },
            {
              name: "newBorrowEnc",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "sweepToken",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "to",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "LeveragedStrategyOpened",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "strategyId",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "StrategyRebalanced",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidEncryptedInput",
      inputs: [
        {
          name: "got",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "expected",
          type: "uint8",
          internalType: "uint8"
        }
      ]
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    }
  ],
  SwapRouter: [
    {
      type: "constructor",
      inputs: [
        {
          name: "executor_",
          type: "address",
          internalType: "address"
        },
        {
          name: "minDeadlineOffset_",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "maxDeadlineOffset_",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "executorRotationDelay_",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "uniswapV3Router_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "MAX_DEADLINE_OFFSET",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "MIN_DEADLINE_OFFSET",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "ROTATION_DELAY",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "UNISWAP_V3_ROUTER",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptExecutor",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "cancelIntent",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "executeIntent",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "outputAmount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "executor",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getIntentMeta",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "tokenIn",
          type: "address",
          internalType: "address"
        },
        {
          name: "tokenOut",
          type: "address",
          internalType: "address"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        },
        {
          name: "deadline",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingRole",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingRoleEarliest",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "proposeExecutor",
      inputs: [
        {
          name: "newExecutor",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "submitSwapIntent",
      inputs: [
        {
          name: "tokenIn",
          type: "address",
          internalType: "address"
        },
        {
          name: "tokenOut",
          type: "address",
          internalType: "address"
        },
        {
          name: "amountIn",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "minAmountOut",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "deadlineOffset",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "swapViaUniswapV3MultiHop",
      inputs: [
        {
          name: "path",
          type: "bytes",
          internalType: "bytes"
        },
        {
          name: "amountIn",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "amountOutMinimum",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "amountOut",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "swapViaUniswapV3Single",
      inputs: [
        {
          name: "tokenIn",
          type: "address",
          internalType: "address"
        },
        {
          name: "tokenOut",
          type: "address",
          internalType: "address"
        },
        {
          name: "fee",
          type: "uint24",
          internalType: "uint24"
        },
        {
          name: "amountIn",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "amountOutMinimum",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "amountOut",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "ExecutorProposed",
      inputs: [
        {
          name: "newExecutor",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "earliest",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "ExecutorRotated",
      inputs: [
        {
          name: "previousExecutor",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newExecutor",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "IntentCancelled",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "IntentExecuted",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "outputAmount",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "IntentSubmitted",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "tokenIn",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "tokenOut",
          type: "address",
          indexed: false,
          internalType: "address"
        },
        {
          name: "deadline",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "UniswapV3MultiHopSwap",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amountIn",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "amountOut",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "UniswapV3SingleSwap",
      inputs: [
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "tokenIn",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "tokenOut",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amountIn",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        },
        {
          name: "amountOut",
          type: "uint256",
          indexed: false,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "DeadlineTooLong",
      inputs: []
    },
    {
      type: "error",
      name: "DeadlineTooShort",
      inputs: []
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InsufficientOutput",
      inputs: []
    },
    {
      type: "error",
      name: "IntentExpired",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "NoPendingRole",
      inputs: []
    },
    {
      type: "error",
      name: "NotCreator",
      inputs: []
    },
    {
      type: "error",
      name: "NotExecutor",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SameToken",
      inputs: []
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TimelockNotElapsed",
      inputs: []
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "UnknownIntent",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroOutput",
      inputs: []
    }
  ],
  PriceOracle: [
    {
      type: "constructor",
      inputs: [
        {
          name: "pyth_",
          type: "address",
          internalType: "address"
        },
        {
          name: "defaultStaleThreshold_",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "DEFAULT_STALE_THRESHOLD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "MAX_PYTH_EXP",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "int256",
          internalType: "int256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "PYTH",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract IPyth"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD_DECIMALS",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint8",
          internalType: "uint8"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "batchSetSources",
      inputs: [
        {
          name: "feeds",
          type: "tuple[]",
          internalType: "struct PriceOracle.FeedInfo[]",
          components: [
            {
              name: "token",
              type: "address",
              internalType: "address"
            },
            {
              name: "staleThreshold",
              type: "uint64",
              internalType: "uint64"
            },
            {
              name: "decimals",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "priceId",
              type: "bytes32",
              internalType: "bytes32"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "collateralFactorBps",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint16",
          internalType: "uint16"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "convertFromUsd",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "usdWad",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "convertToUsd",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "usdWad",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getPriceUsd",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "priceWad",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "updatedAt",
          type: "uint64",
          internalType: "uint64"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getPriceWithFallback",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "priceWad",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getPythUpdateFee",
      inputs: [
        {
          name: "updateData",
          type: "bytes[]",
          internalType: "bytes[]"
        }
      ],
      outputs: [
        {
          name: "feeAmount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isStale",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "stale",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isSupported",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "supported",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isTokenRegistered",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "lastPriceUpdate",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "liquidationThresholdBps",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint16",
          internalType: "uint16"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "priceId",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "registeredTokens",
      inputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "removeFallbackPrice",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "removeSource",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setCollateralFactor",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "ltvBps",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "liqThresholdBps",
          type: "uint16",
          internalType: "uint16"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setFallbackPrice",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "price",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setSource",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "priceId_",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "decimals_",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "threshold_",
          type: "uint64",
          internalType: "uint64"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setStalenessThreshold",
      inputs: [
        {
          name: "newThreshold",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "staleThreshold",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint64",
          internalType: "uint64"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "stalenessThreshold",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "sweepEth",
      inputs: [
        {
          name: "to",
          type: "address",
          internalType: "address payable"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "tokenDecimals",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint8",
          internalType: "uint8"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "updatePriceFeeds",
      inputs: [
        {
          name: "updateData",
          type: "bytes[]",
          internalType: "bytes[]"
        }
      ],
      outputs: [],
      stateMutability: "payable"
    },
    {
      type: "event",
      name: "CollateralFactorSet",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "ltvBps",
          type: "uint16",
          indexed: true,
          internalType: "uint16"
        },
        {
          name: "liqThresholdBps",
          type: "uint16",
          indexed: true,
          internalType: "uint16"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "FallbackPriceRemoved",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "FallbackPriceSet",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "price",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PythCacheUpdated",
      inputs: [
        {
          name: "caller",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "feePaid",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "SourceSet",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "priceId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "tokenDecimals",
          type: "uint8",
          indexed: true,
          internalType: "uint8"
        },
        {
          name: "staleThreshold",
          type: "uint64",
          indexed: false,
          internalType: "uint64"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "SourcesBatchSet",
      inputs: [
        {
          name: "count",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "StalenessThresholdUpdated",
      inputs: [
        {
          name: "oldThreshold",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "newThreshold",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidBps",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "NegativePrice",
      inputs: []
    },
    {
      type: "error",
      name: "NoPriceAvailable",
      inputs: []
    },
    {
      type: "error",
      name: "NoPriceFeed",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "PythUpdateFeeMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "SafeCastOverflowedIntToUint",
      inputs: [
        {
          name: "value",
          type: "int256",
          internalType: "int256"
        }
      ]
    },
    {
      type: "error",
      name: "SafeCastOverflowedUintDowncast",
      inputs: [
        {
          name: "bits",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "value",
          type: "uint256",
          internalType: "uint256"
        }
      ]
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "UncertainPrice",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroPrice",
      inputs: []
    }
  ],
  StrategyRegistry: [
    {
      type: "constructor",
      inputs: [
        {
          name: "vaultRotationDelay_",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "MAX_NAME_LENGTH",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "MIN_NAME_LENGTH",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "ROTATION_DELAY",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "acceptVault",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "broadcastStrategy",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "destinationDomain",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "decrementTvl",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "amount",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "getEncryptedTvl",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "v",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "getStrategyMeta",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "name",
          type: "string",
          internalType: "string"
        },
        {
          name: "workflowHash",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "creator",
          type: "address",
          internalType: "address"
        },
        {
          name: "createdAt",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "active",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getStrategyParams",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "apyTarget",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "loopCount",
          type: "uint8",
          internalType: "uint8"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "idByContentHash",
      inputs: [
        {
          name: "",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "incrementTvl",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "amount",
          type: "bytes32",
          internalType: "euint128"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "localDomain",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingRole",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingRoleEarliest",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "proposeVault",
      inputs: [
        {
          name: "newVault",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "receiveCrossChainStrategy",
      inputs: [
        {
          name: "sourceDomain",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "sourceStrategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "name",
          type: "string",
          internalType: "string"
        },
        {
          name: "workflowHash",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "creator",
          type: "address",
          internalType: "address"
        },
        {
          name: "apyTarget",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "loopCount",
          type: "uint8",
          internalType: "uint8"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "registerStrategy",
      inputs: [
        {
          name: "name",
          type: "string",
          internalType: "string"
        },
        {
          name: "workflowHash",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "apyTarget",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "loopCount",
          type: "uint8",
          internalType: "uint8"
        }
      ],
      outputs: [
        {
          name: "id",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "registerStrategy",
      inputs: [
        {
          name: "name",
          type: "string",
          internalType: "string"
        },
        {
          name: "workflowHash",
          type: "bytes32",
          internalType: "bytes32"
        }
      ],
      outputs: [
        {
          name: "id",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setActive",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "active",
          type: "bool",
          internalType: "bool"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "setVault",
      inputs: [
        {
          name: "v",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "strategyCount",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "vaultAddress",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "event",
      name: "CrossChainMessage",
      inputs: [
        {
          name: "destinationDomain",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "sender",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "payload",
          type: "bytes",
          indexed: false,
          internalType: "bytes"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "StrategyActiveSet",
      inputs: [
        {
          name: "id",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "active",
          type: "bool",
          indexed: true,
          internalType: "bool"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "StrategyRegistered",
      inputs: [
        {
          name: "id",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "creator",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "name",
          type: "string",
          indexed: false,
          internalType: "string"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TvlDecreased",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "caller",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TvlIncreased",
      inputs: [
        {
          name: "strategyId",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "caller",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "VaultProposed",
      inputs: [
        {
          name: "newVault",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "earliest",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "VaultSet",
      inputs: [
        {
          name: "vault",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EmptyName",
      inputs: []
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "FhePermissionDenied",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidStrategyId",
      inputs: []
    },
    {
      type: "error",
      name: "NameTooLong",
      inputs: []
    },
    {
      type: "error",
      name: "NoPendingRole",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyCreator",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyVault",
      inputs: []
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "StrategyAlreadyExists",
      inputs: []
    },
    {
      type: "error",
      name: "StrategyInactive",
      inputs: []
    },
    {
      type: "error",
      name: "TimelockNotElapsed",
      inputs: []
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "VaultAlreadySet",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroWorkflowHash",
      inputs: []
    }
  ],
  StrategyExecutor: [
    {
      type: "constructor",
      inputs: [
        {
          name: "pool_",
          type: "address",
          internalType: "address"
        },
        {
          name: "vault_",
          type: "address",
          internalType: "address"
        },
        {
          name: "router_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "ADD_COLLATERAL",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "BORROW_LTV",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "DEPOSIT_VAULT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "POOL",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract ILendingPool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "REPAY_DEBT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "ROUTER",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract ISwapRouter"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "SHIELD_SUPPLY",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "SWAP_INTENT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "SWAP_UNISWAP_V3",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "VAULT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "contract IStrategyVault"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WITHDRAW_VAULT",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "bytes4",
          internalType: "bytes4"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "checkpoints",
      inputs: [
        {
          name: "",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "actionIndex",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "completed",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "executePipeline",
      inputs: [
        {
          name: "strategyId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "actions",
          type: "tuple[]",
          internalType: "struct StrategyExecutor.Action[]",
          components: [
            {
              name: "actionType",
              type: "bytes4",
              internalType: "bytes4"
            },
            {
              name: "params",
              type: "bytes",
              internalType: "bytes"
            },
            {
              name: "encAmount",
              type: "tuple",
              internalType: "struct InEuint128",
              components: [
                {
                  name: "ctHash",
                  type: "uint256",
                  internalType: "uint256"
                },
                {
                  name: "securityZone",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "utype",
                  type: "uint8",
                  internalType: "uint8"
                },
                {
                  name: "signature",
                  type: "bytes",
                  internalType: "bytes"
                }
              ]
            }
          ]
        }
      ],
      outputs: [
        {
          name: "completed",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "resetCheckpoint",
      inputs: [
        {
          name: "strategyId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "sweepToken",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "to",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "ActionExecuted",
      inputs: [
        {
          name: "strategyId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "index",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "actionType",
          type: "bytes4",
          indexed: true,
          internalType: "bytes4"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "PipelineExecuted",
      inputs: [
        {
          name: "strategyId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "stepsCompleted",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        },
        {
          name: "completed",
          type: "bool",
          indexed: true,
          internalType: "bool"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidEncryptedInput",
      inputs: [
        {
          name: "got",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "expected",
          type: "uint8",
          internalType: "uint8"
        }
      ]
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "UnknownActionType",
      inputs: [
        {
          name: "actionType",
          type: "bytes4",
          internalType: "bytes4"
        }
      ]
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    }
  ],
  TokenRegistry: [
    {
      type: "function",
      name: "BPS_DEN",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "WAD",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "acceptOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "disableToken",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "getBorrowableTokens",
      inputs: [],
      outputs: [
        {
          name: "result",
          type: "address[]",
          internalType: "address[]"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getCollateralTokens",
      inputs: [],
      outputs: [
        {
          name: "result",
          type: "address[]",
          internalType: "address[]"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getLendableTokens",
      inputs: [],
      outputs: [
        {
          name: "result",
          type: "address[]",
          internalType: "address[]"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "getTokenCount",
      inputs: [],
      outputs: [
        {
          name: "count",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isRegistered",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "isTokenEnabled",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "enabled",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "owner_",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "paused",
      inputs: [],
      outputs: [
        {
          name: "isPaused",
          type: "bool",
          internalType: "bool"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "pendingOwner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "registerToken",
      inputs: [
        {
          name: "info",
          type: "tuple",
          internalType: "struct TokenRegistry.TokenInfo",
          components: [
            {
              name: "token",
              type: "address",
              internalType: "address"
            },
            {
              name: "ltvBps",
              type: "uint16",
              internalType: "uint16"
            },
            {
              name: "liquidationBonusBps",
              type: "uint16",
              internalType: "uint16"
            },
            {
              name: "decimals",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "isLendable",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "isBorrowable",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "isCollateral",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "enabled",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "pythPriceId",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "borrowCap",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "supplyCap",
              type: "uint256",
              internalType: "uint256"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "removeToken",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "tokenList",
      inputs: [
        {
          name: "",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "tokens",
      inputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "ltvBps",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "liquidationBonusBps",
          type: "uint16",
          internalType: "uint16"
        },
        {
          name: "decimals",
          type: "uint8",
          internalType: "uint8"
        },
        {
          name: "isLendable",
          type: "bool",
          internalType: "bool"
        },
        {
          name: "isBorrowable",
          type: "bool",
          internalType: "bool"
        },
        {
          name: "isCollateral",
          type: "bool",
          internalType: "bool"
        },
        {
          name: "enabled",
          type: "bool",
          internalType: "bool"
        },
        {
          name: "pythPriceId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "borrowCap",
          type: "uint256",
          internalType: "uint256"
        },
        {
          name: "supplyCap",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "updateTokenConfig",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "info",
          type: "tuple",
          internalType: "struct TokenRegistry.TokenInfo",
          components: [
            {
              name: "token",
              type: "address",
              internalType: "address"
            },
            {
              name: "ltvBps",
              type: "uint16",
              internalType: "uint16"
            },
            {
              name: "liquidationBonusBps",
              type: "uint16",
              internalType: "uint16"
            },
            {
              name: "decimals",
              type: "uint8",
              internalType: "uint8"
            },
            {
              name: "isLendable",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "isBorrowable",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "isCollateral",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "enabled",
              type: "bool",
              internalType: "bool"
            },
            {
              name: "pythPriceId",
              type: "bytes32",
              internalType: "bytes32"
            },
            {
              name: "borrowCap",
              type: "uint256",
              internalType: "uint256"
            },
            {
              name: "supplyCap",
              type: "uint256",
              internalType: "uint256"
            }
          ]
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "OwnershipTransferStarted",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Paused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TokenDisabled",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TokenRegistered",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "priceId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "decimals",
          type: "uint8",
          indexed: true,
          internalType: "uint8"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TokenUpdated",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "Unpaused",
      inputs: [
        {
          name: "account",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "EthTransferFailed",
      inputs: []
    },
    {
      type: "error",
      name: "GuardEnforcedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardExpectedPause",
      inputs: []
    },
    {
      type: "error",
      name: "GuardReentrantCall",
      inputs: []
    },
    {
      type: "error",
      name: "InvalidCiphertext",
      inputs: []
    },
    {
      type: "error",
      name: "OnlyOwner",
      inputs: []
    },
    {
      type: "error",
      name: "SecurityZoneOutOfBounds",
      inputs: [
        {
          name: "value",
          type: "int32",
          internalType: "int32"
        }
      ]
    },
    {
      type: "error",
      name: "TokenMismatch",
      inputs: []
    },
    {
      type: "error",
      name: "TokenNotRegistered",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAddress",
      inputs: []
    },
    {
      type: "error",
      name: "ZeroAmount",
      inputs: []
    }
  ],
  ExecutorContract: [
    {
      type: "constructor",
      inputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "approveToken",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "spender",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "executeIntent",
      inputs: [
        {
          name: "router",
          type: "address",
          internalType: "address"
        },
        {
          name: "intentId",
          type: "bytes32",
          internalType: "bytes32"
        },
        {
          name: "outputAmount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "owner",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "address",
          internalType: "address"
        }
      ],
      stateMutability: "view"
    },
    {
      type: "function",
      name: "renounceOwnership",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "transferOwnership",
      inputs: [
        {
          name: "newOwner",
          type: "address",
          internalType: "address"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "function",
      name: "withdrawTokens",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          internalType: "uint256"
        }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    },
    {
      type: "event",
      name: "IntentExecuted",
      inputs: [
        {
          name: "intentId",
          type: "bytes32",
          indexed: true,
          internalType: "bytes32"
        },
        {
          name: "user",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "outputAmount",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "OwnershipTransferred",
      inputs: [
        {
          name: "previousOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "newOwner",
          type: "address",
          indexed: true,
          internalType: "address"
        }
      ],
      anonymous: false
    },
    {
      type: "event",
      name: "TokensWithdrawn",
      inputs: [
        {
          name: "token",
          type: "address",
          indexed: true,
          internalType: "address"
        },
        {
          name: "amount",
          type: "uint256",
          indexed: true,
          internalType: "uint256"
        }
      ],
      anonymous: false
    },
    {
      type: "error",
      name: "OwnableInvalidOwner",
      inputs: [
        {
          name: "owner",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "OwnableUnauthorizedAccount",
      inputs: [
        {
          name: "account",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "SafeERC20FailedOperation",
      inputs: [
        {
          name: "token",
          type: "address",
          internalType: "address"
        }
      ]
    },
    {
      type: "error",
      name: "TransferFailed",
      inputs: []
    }
  ]
};
var CONTRACT_ADDRESSES = {
  LendingPool: "0x2e04961e0d4448FeeeA5b23593eC81C1C9A2cD2a",
  StrategyVault: "0xe9486B12261D02BeB236355934981d49c5697fb3",
  Composer: "0xBcaEF72afA1f207F44C5aa11E48a7bea4b71632C",
  SwapRouter: "0x5218486A8831b53b509CDF2390b3b6333B4d0bf7",
  PriceOracle: "0x8E41d720173c347740C05011FadD3a3B015ae18c",
  StrategyRegistry: "0xEbBD1aFDCC888116a4c3800ec856c8c3b1535374",
  StrategyExecutor: "0x157DE38216598dA56eEA78452329075cD511374B",
  TokenRegistry: "0xA2E36B9953518d4Cd2E9c7e3b5345f8E8B8Bb19B",
  ExecutorContract: "0x270F526b27cf7bf810a61e5f14f904C51CdC3deA"
};

// src/contract.js
var ERROR_CODE_MAP = {
  LendingPool: {
    LtvNumeratorZero: "LTV_NUMERATOR_ZERO",
    LtvDenominatorZero: "LTV_DENOMINATOR_ZERO",
    LtvExceedsHundredPercent: "LTV_EXCEEDS_100_PCT",
    InsufficientCollateral: "INSUFFICIENT_COLLATERAL",
    InsufficientReserve: "INSUFFICIENT_RESERVE",
    OracleNotSet: "ORACLE_NOT_SET",
    WethNotSet: "WETH_NOT_SET",
    LiquidationTooLarge: "LIQUIDATION_TOO_LARGE",
    NotComposer: "NOT_COMPOSER",
    InvalidProof: "INVALID_PROOF",
    FlashLoanNotRepaid: "FLASH_LOAN_NOT_REPAID",
    FlashLoanUnsupportedToken: "FLASH_LOAN_UNSUPPORTED_TOKEN",
    CannotSelfLiquidate: "CANNOT_SELF_LIQUIDATE",
    NotAuthorized: "NOT_AUTHORIZED",
    RevealCooldown: "REVEAL_COOLDOWN"
  },
  StrategyVault: {
    PositionNotFound: "POSITION_NOT_FOUND",
    InvalidStrategyId: "INVALID_STRATEGY_ID",
    NoPosition: "NO_POSITION",
    ExceedsDeposit: "EXCEEDS_DEPOSIT",
    SameBlockClose: "SAME_BLOCK_CLOSE",
    NotPositionOwner: "NOT_POSITION_OWNER"
  },
  SwapRouter: {
    SameToken: "SAME_TOKEN",
    UnknownIntent: "UNKNOWN_INTENT",
    NotCreator: "NOT_INTENT_CREATOR",
    NotExecutor: "NOT_EXECUTOR",
    IntentExpired: "INTENT_EXPIRED",
    ZeroOutput: "ZERO_OUTPUT",
    InsufficientOutput: "INSUFFICIENT_OUTPUT",
    DeadlineTooShort: "DEADLINE_TOO_SHORT",
    DeadlineTooLong: "DEADLINE_TOO_LONG"
  },
  PriceOracle: {
    NoPriceAvailable: "NO_PRICE_AVAILABLE"
  },
  Composer: {
    ZeroAddress: "ZERO_ADDRESS",
    ZeroAmount: "ZERO_AMOUNT"
  },
  StrategyExecutor: {
    ZeroAddress: "ZERO_ADDRESS",
    ZeroAmount: "ZERO_AMOUNT"
  }
};
function buildErrorPattern() {
  const names = [];
  for (const map of Object.values(ERROR_CODE_MAP)) {
    names.push(...Object.keys(map));
  }
  names.sort((a, b) => b.length - a.length);
  return new RegExp(names.join("|"));
}
var REVERT_REASON_PATTERN = buildErrorPattern();
function mapContractError(error, _contractName, functionName) {
  const message = error.message || "Unknown contract error";
  const match = message.match(REVERT_REASON_PATTERN);
  if (match) {
    const reason = match[0];
    for (const map of Object.values(ERROR_CODE_MAP)) {
      if (map[reason]) {
        return new ContractError(map[reason], message, true);
      }
    }
  }
  if (message.includes("User denied") || message.includes("user rejected")) {
    return new ContractError("USER_REJECTED", "Transaction was rejected by the user", true);
  }
  if (message.includes("insufficient funds")) {
    return new ContractError("INSUFFICIENT_FUNDS", "Insufficient ETH for gas", false);
  }
  if (message.includes("gas required exceeds allowance") || message.includes("intrinsic gas too low")) {
    return new ContractError("GAS_ESTIMATION_FAILED", `Gas estimation failed for ${functionName}`, true);
  }
  if (message.includes("execution reverted")) {
    return new ContractError("EXECUTION_REVERTED", `Transaction reverted: ${message}`, false);
  }
  if (message.includes("network") && message.includes("timeout")) {
    return new ContractError("NETWORK_TIMEOUT", "Network timeout. Check your connection.", true);
  }
  return new ContractError("CONTRACT_ERROR", message, false);
}
async function estimateSendAndWait(publicClient, walletClient, address, abi, functionName, args, account) {
  let gas;
  try {
    gas = await publicClient.estimateContractGas({ address, abi, functionName, args, account });
  } catch (error) {
    throw mapContractError(error, "", functionName);
  }
  let hash;
  try {
    hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      gas,
      account,
      chain: arbitrumSepolia
    });
    const bridgeBus2 = typeof window !== "undefined" ? window.__bridgeBus : null;
    if (bridgeBus2) {
      bridgeBus2.set("transaction:submitted", { hash, functionName });
    }
  } catch (error) {
    throw mapContractError(error, "", functionName);
  }
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch (_error) {
    throw new Error(`Transaction ${hash} submitted but confirmation timed out. Check block explorer.`);
  }
  const status = receipt.status === "success" ? "confirmed" : "reverted";
  const bridgeBus = typeof window !== "undefined" ? window.__bridgeBus : null;
  if (bridgeBus) {
    bridgeBus.set(status === "confirmed" ? "transaction:confirmed" : "transaction:failed", { hash, functionName, status });
  }
  return {
    hash,
    status,
    blockNumber: Number(receipt.blockNumber),
    receipt
  };
}
var DEFAULT_RPC_URL = "https://sepolia-arbitrum-rpc.publicnode.com";
var ERC20_READ_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable"
  }
];
function createContractAdapter(config, options = {}) {
  const { apiAdapter, fheAdapter: _fheAdapter } = options;
  const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl)
  });
  let _walletClient = null;
  let _walletProvider = null;
  const read = {
    getSupplyBalance: (token) => publicClient.readContract({
      address: CONTRACT_ADDRESSES.LendingPool,
      abi: CONTRACT_ABIS.LendingPool,
      functionName: "getSupplyBalance",
      args: [token]
    }),
    getBorrowBalance: (token) => publicClient.readContract({
      address: CONTRACT_ADDRESSES.LendingPool,
      abi: CONTRACT_ABIS.LendingPool,
      functionName: "getBorrowBalance",
      args: [token]
    }),
    getCollateral: (positionId) => publicClient.readContract({
      address: CONTRACT_ADDRESSES.StrategyVault,
      abi: CONTRACT_ABIS.StrategyVault,
      functionName: "getCollateral",
      args: [positionId]
    }),
    getPositionMeta: (positionId) => publicClient.readContract({
      address: CONTRACT_ADDRESSES.StrategyVault,
      abi: CONTRACT_ABIS.StrategyVault,
      functionName: "getPositionMeta",
      args: [positionId]
    }),
    getUserPositions: (user) => publicClient.readContract({
      address: CONTRACT_ADDRESSES.StrategyVault,
      abi: CONTRACT_ABIS.StrategyVault,
      functionName: "getUserPositions",
      args: [user]
    }),
    getLendableTokens: () => publicClient.readContract({
      address: CONTRACT_ADDRESSES.TokenRegistry,
      abi: CONTRACT_ABIS.TokenRegistry,
      functionName: "getLendableTokens",
      args: []
    }),
    erc20Allowance: (token, owner, spender) => publicClient.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: "allowance",
      args: [owner, spender]
    })
  };
  const write = {
    shieldCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError("INVALID_AMOUNT", "Amount must be greater than zero");
      if (!token || token === "0x0000000000000000000000000000000000000000")
        throw new ContractError("INVALID_TOKEN", "Invalid token address");
      const encAmount = _fheAdapter && typeof _fheAdapter.encrypt === "function" ? await _fheAdapter.encrypt(String(amount), token) : undefined;
      const wc = getWc();
      const result = await estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "shield", [token, encAmount], account);
      let commitId = "";
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[0] && log.data && log.data !== "0x" && log.address?.toLowerCase() === CONTRACT_ADDRESSES.LendingPool.toLowerCase()) {
            commitId = log.topics[1] ?? log.data.slice(0, 66);
            break;
          }
        }
      }
      return { ...result, commitId };
    },
    shieldExecute: async (token, commitId, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(commitId);
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "executeShield", [token, commitId, plaintext, signature], account);
    },
    borrowCommit: async (collateralToken, borrowToken, amount, ltvNum, ltvDen, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError("INVALID_AMOUNT", "Amount must be greater than zero");
      if (!collateralToken || collateralToken === "0x0000000000000000000000000000000000000000")
        throw new ContractError("INVALID_TOKEN", "Invalid token address");
      const encAmount = _fheAdapter && typeof _fheAdapter.encrypt === "function" ? await _fheAdapter.encrypt(String(amount), borrowToken) : undefined;
      const wc = getWc();
      const result = await estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "commitBorrow", [collateralToken, borrowToken, encAmount, ltvNum, ltvDen], account);
      let commitId = "";
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[0] && log.data && log.data !== "0x" && log.address?.toLowerCase() === CONTRACT_ADDRESSES.LendingPool.toLowerCase()) {
            commitId = log.topics[1] ?? log.data.slice(0, 66);
            break;
          }
        }
      }
      return { ...result, commitId };
    },
    borrowExecute: async (commitId, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(commitId);
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "executeBorrow", [commitId, plaintext, signature], account);
    },
    repayCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError("INVALID_AMOUNT", "Amount must be greater than zero");
      if (!token || token === "0x0000000000000000000000000000000000000000")
        throw new ContractError("INVALID_TOKEN", "Invalid token address");
      const encAmount = _fheAdapter && typeof _fheAdapter.encrypt === "function" ? await _fheAdapter.encrypt(String(amount), token) : undefined;
      const wc = getWc();
      const result = await estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "repay", [token, encAmount], account);
      let commitId = "";
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[0] && log.data && log.data !== "0x" && log.address?.toLowerCase() === CONTRACT_ADDRESSES.LendingPool.toLowerCase()) {
            commitId = log.topics[1] ?? log.data.slice(0, 66);
            break;
          }
        }
      }
      return { ...result, commitId };
    },
    repayExecute: async (token, commitId, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(commitId);
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "executeRepay", [token, commitId, plaintext, signature], account);
    },
    withdrawCommit: async (token, amount, account) => {
      if (!amount || amount <= 0n)
        throw new ContractError("INVALID_AMOUNT", "Amount must be greater than zero");
      if (!token || token === "0x0000000000000000000000000000000000000000")
        throw new ContractError("INVALID_TOKEN", "Invalid token address");
      const encAmount = _fheAdapter && typeof _fheAdapter.encrypt === "function" ? await _fheAdapter.encrypt(String(amount), token) : undefined;
      const wc = getWc();
      const result = await estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "withdraw", [token, encAmount], account);
      let commitId = "";
      if (result.receipt?.logs) {
        for (const log of result.receipt.logs) {
          if (log.topics?.[0] && log.data && log.data !== "0x" && log.address?.toLowerCase() === CONTRACT_ADDRESSES.LendingPool.toLowerCase()) {
            commitId = log.topics[1] ?? log.data.slice(0, 66);
            break;
          }
        }
      }
      return { ...result, commitId };
    },
    withdrawExecute: async (token, commitId, account) => {
      const { plaintext, signature } = await _fheAdapter.decryptForExecute(commitId);
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.LendingPool, CONTRACT_ABIS.LendingPool, "executeWithdraw", [token, commitId, plaintext, signature], account);
    },
    composerOpenPosition: async (params, account) => {
      const EMPTY_ENC = { ctHash: 0n, securityZone: 0, utype: 0, signature: "0x" };
      let collateralEnc = EMPTY_ENC;
      let supplyEnc = EMPTY_ENC;
      let borrowEnc = EMPTY_ENC;
      if (_fheAdapter && typeof _fheAdapter.encrypt === "function") {
        const encPromises = [];
        if (params.collateralAmount > 0n) {
          encPromises.push(_fheAdapter.encrypt(String(params.collateralAmount), params.collateralToken).then((h) => {
            collateralEnc = h;
          }));
        }
        if (params.poolSupplyAmount > 0n) {
          encPromises.push(_fheAdapter.encrypt(String(params.poolSupplyAmount), params.collateralToken).then((h) => {
            supplyEnc = h;
          }));
        }
        if (params.poolBorrowAmount > 0n) {
          encPromises.push(_fheAdapter.encrypt(String(params.poolBorrowAmount), params.borrowToken).then((h) => {
            borrowEnc = h;
          }));
        }
        await Promise.all(encPromises);
      }
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.Composer, CONTRACT_ABIS.Composer, "openPosition", [params, { collateral: collateralEnc, supplyEnc, borrowEnc }], account);
    },
    submitSwapIntent: async (tokenIn, tokenOut, amountIn, minAmountOut, deadlineOffset, account) => {
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, CONTRACT_ADDRESSES.SwapRouter, CONTRACT_ABIS.SwapRouter, "submitSwapIntent", [tokenIn, tokenOut, amountIn, minAmountOut, deadlineOffset], account);
    },
    erc20Approve: async (token, spender, account) => {
      const wc = getWc();
      return estimateSendAndWait(publicClient, wc, token, ERC20_READ_ABI, "approve", [spender, 2n ** 256n - 1n], account);
    }
  };
  const simulate = {
    strategy: async (data) => {
      if (!apiAdapter?.defiStrategies?.simulateDefiStrategy) {
        throw new ContractError("API_ADAPTER_REQUIRED", "API adapter with defiStrategies.simulateDefiStrategy is required for simulation");
      }
      return apiAdapter.defiStrategies.simulateDefiStrategy(data);
    }
  };
  function getWc() {
    if (_walletClient)
      return _walletClient;
    const provider = _walletProvider || (typeof window !== "undefined" && window.ethereum ? window.ethereum : null);
    if (provider) {
      _walletClient = createWalletClient({
        chain: arbitrumSepolia,
        transport: custom(provider)
      });
      return _walletClient;
    }
    throw new ContractError("WALLET_UNAVAILABLE", "No wallet client available. Connect a wallet (MetaMask/Rabby) or provide a wallet client.");
  }
  const multicallRead = async (calls) => {
    const results = await publicClient.multicall({
      contracts: calls.map((c) => ({
        address: c.address,
        abi: c.abi,
        functionName: c.functionName,
        args: c.args
      })),
      allowFailure: true
    });
    return results.map((r) => ({
      success: r.status === "success",
      result: r.status === "success" ? r.result : null,
      error: r.status === "failure" ? r.error : null
    }));
  };
  const getAllBalances = async (tokens) => {
    const lp = CONTRACT_ADDRESSES.LendingPool;
    const lpAbi = CONTRACT_ABIS.LendingPool;
    const calls = tokens.flatMap((t) => [
      { address: lp, abi: lpAbi, functionName: "getSupplyBalance", args: [t] },
      { address: lp, abi: lpAbi, functionName: "getBorrowBalance", args: [t] }
    ]);
    return multicallRead(calls);
  };
  const getAllPositionData = async (positionIds) => {
    const sv = CONTRACT_ADDRESSES.StrategyVault;
    const svAbi = CONTRACT_ABIS.StrategyVault;
    const calls = positionIds.flatMap((pid) => [
      { address: sv, abi: svAbi, functionName: "getPositionMeta", args: [pid] },
      { address: sv, abi: svAbi, functionName: "getCollateral", args: [pid] }
    ]);
    return multicallRead(calls);
  };
  return {
    read,
    write,
    simulate,
    multicallRead,
    getAllBalances,
    getAllPositionData
  };
}

// src/fhe.js
var PERMIT_DURATION_MS = 900000;
function createFheAdapter(config) {
  let _grantedAt = 0;
  let _unlocked = false;
  let _cofheClient = null;
  const _listeners = new Set;
  function computePermitState() {
    if (!_unlocked) {
      return { unlocked: false, secondsLeft: 0 };
    }
    const elapsed = Date.now() - _grantedAt;
    if (elapsed >= PERMIT_DURATION_MS) {
      _unlocked = false;
      return { unlocked: false, secondsLeft: 0 };
    }
    return {
      unlocked: true,
      secondsLeft: Math.floor((PERMIT_DURATION_MS - elapsed) / 1000)
    };
  }
  function notifyListeners() {
    const state = computePermitState();
    for (const fn of _listeners) {
      try {
        fn(state);
      } catch {}
    }
  }
  async function permitGrant() {
    try {
      const { createCofheConfig, createCofheClient } = await import("@cofhe/sdk/web");
      const { chains } = await import("@cofhe/sdk/chains");
      const config2 = createCofheConfig({
        supportedChains: [chains.arbitrumSepolia || chains.arbSepolia || { id: 421614 }]
      });
      _cofheClient = createCofheClient(config2);
      const { createPublicClient: createPublicClient2, createWalletClient: createWalletClient2, http: http2, custom: custom2 } = await import("viem");
      const { arbitrumSepolia: arbitrumSepolia2 } = await import("viem/chains");
      const publicClient = createPublicClient2({
        chain: arbitrumSepolia2,
        transport: http2()
      });
      const walletClient = createWalletClient2({
        chain: arbitrumSepolia2,
        transport: custom2(window.ethereum)
      });
      await _cofheClient.connect(publicClient, walletClient);
      await _cofheClient.permits.getOrCreateSelfPermit();
      _grantedAt = Date.now();
      _unlocked = true;
      notifyListeners();
      return computePermitState();
    } catch (error) {
      throw new FheError("PERMIT_GRANT_FAILED", error.message || "Failed to grant FHE permit");
    }
  }
  function permitCheck() {
    return computePermitState();
  }
  async function encrypt(plaintext, tokenAddress) {
    try {
      if (!_cofheClient) {
        throw new FheError("NO_PERMIT", "Grant an FHE permit before encrypting");
      }
      const { Encryptable } = await import("@cofhe/sdk");
      const [encryptedHandle] = await _cofheClient.encryptInputs([Encryptable.uint128(BigInt(plaintext))]).execute();
      return encryptedHandle;
    } catch (error) {
      throw new FheError("ENCRYPT_FAILED", error.message || "Failed to encrypt value");
    }
  }
  async function decrypt(handle) {
    if (!_cofheClient) {
      throw new FheError("NO_PERMIT", "Grant an FHE permit before decrypting");
    }
    try {
      const plaintext = await _cofheClient.decrypt(handle);
      return String(plaintext);
    } catch (error) {
      throw new FheError("DECRYPT_FAILED", error.message || "Failed to decrypt value");
    }
  }
  async function decryptForExecute(ctHash, opts = {}) {
    if (!_cofheClient) {
      throw new FheError("NO_PERMIT", "Grant an FHE permit before decrypting for tx");
    }
    const timeout = opts.timeout ?? 60000;
    const pollInterval = opts.pollInterval ?? 2000;
    const start = Date.now();
    try {
      const result = await _cofheClient.decryptForTx(ctHash).withoutPermit().execute();
      return {
        plaintext: String(result.decryptedValue),
        signature: result.signature
      };
    } catch (error) {
      const elapsed = Date.now() - start;
      if (elapsed >= timeout) {
        throw new FheError("DECRYPT_TIMEOUT", `Decryption for tx timed out after ${Math.round(elapsed / 1000)}s for handle ${ctHash}`);
      }
      if (error.message && error.message.includes("not ready")) {
        throw new FheError("DECRYPT_NOT_READY", `Ciphertext ${ctHash} is not yet ready for decryption: ${error.message}`);
      }
      throw new FheError("DECRYPT_FOR_TX_FAILED", error.message || `Failed to decrypt ${ctHash} for transaction`);
    }
  }
  function onPermitChange(cb) {
    _listeners.add(cb);
    try {
      cb(computePermitState());
    } catch {}
    return () => {
      _listeners.delete(cb);
    };
  }
  const adapter = {
    permitGrant,
    permitCheck,
    encrypt,
    decrypt,
    decryptForExecute,
    onPermitChange,
    grantPermit: permitGrant
  };
  return adapter;
}

// src/wallet.js
import { walletConnect } from "@wagmi/connectors";
import {
  createConfig as createConfig2,
  createStorage,
  getConnections,
  getConnectors,
  http as http2,
  injected,
  connect as wagmiConnect,
  disconnect as wagmiDisconnect,
  getAccount as wagmiGetAccount,
  getChainId as wagmiGetChainId,
  reconnect as wagmiReconnect,
  signMessage as wagmiSignMessage,
  switchChain as wagmiSwitchChain,
  watchAccount,
  watchChainId
} from "@wagmi/core";
import { createPublicClient as createPublicClient2, http as viemHttp } from "viem";
import { arbitrumSepolia as arbitrumSepolia2 } from "viem/chains";
var _publicClient = null;
var ARB_SEPOLIA_CHAIN_PARAMS = {
  chainId: "0x66eee",
  chainName: "Arbitrum Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia-arbitrum-rpc.publicnode.com"],
  blockExplorerUrls: ["https://sepolia.arbiscan.io"]
};
var _wagmiConfig = null;
function getWagmiConfig(config) {
  if (!_wagmiConfig) {
    _wagmiConfig = createConfig2({
      chains: [arbitrumSepolia2],
      connectors: [
        injected(),
        ...config.walletConnectProjectId ? [walletConnect({ projectId: config.walletConnectProjectId })] : []
      ],
      transports: {
        [arbitrumSepolia2.id]: http2(config.rpcUrl)
      },
      storage: typeof window !== "undefined" ? createStorage({ storage: window.localStorage }) : undefined
    });
  }
  return _wagmiConfig;
}
function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
function getPublicClient(config) {
  if (!_publicClient) {
    _publicClient = createPublicClient2({
      chain: arbitrumSepolia2,
      transport: viemHttp(config.rpcUrl)
    });
  }
  return _publicClient;
}
function createWalletAdapter(config) {
  const wagmiConfig = getWagmiConfig(config);
  if (isBrowser()) {
    wagmiReconnect(wagmiConfig).catch(() => {});
  }
  let unwatchAccountFn = null;
  let unwatchChainFn = null;
  return {
    async connect(connectorId) {
      const connectors = getConnectors(wagmiConfig);
      if (connectorId) {
        const connector = connectors.find((c) => c.id === connectorId);
        if (!connector) {
          throw new WalletError("CONNECTOR_NOT_FOUND", `Connector "${connectorId}" not found. Available: ${connectors.map((c) => c.id).join(", ")}`);
        }
        try {
          const result = await wagmiConnect(wagmiConfig, { connector });
          return { accounts: result };
        } catch (error) {
          throw new WalletError("CONNECT_FAILED", error.message || "Failed to connect wallet");
        }
      }
      try {
        const result = await wagmiConnect(wagmiConfig, {
          connector: connectors[0]
        });
        return { accounts: result };
      } catch (error) {
        throw new WalletError("CONNECT_FAILED", error.message || "Failed to connect wallet.");
      }
    },
    async disconnect() {
      try {
        await wagmiDisconnect(wagmiConfig);
      } catch (_error) {}
    },
    async getProvider() {
      const activeConnection = getConnections(wagmiConfig)?.[0];
      if (activeConnection?.connector?.getProvider) {
        return activeConnection.connector.getProvider();
      }
      return null;
    },
    async switchNetwork(chainId) {
      try {
        await wagmiSwitchChain(wagmiConfig, { chainId });
      } catch (error) {
        const err = error;
        if (err.message?.includes("addEthereumChain") || err.code === 4902 || err.name === "ChainNotConfiguredError") {
          try {
            const connections = getConnections(wagmiConfig);
            const activeConnection = connections?.[0];
            let provider = null;
            if (activeConnection?.connector?.getProvider) {
              provider = await activeConnection.connector.getProvider();
            }
            if (provider?.request) {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [ARB_SEPOLIA_CHAIN_PARAMS]
              });
            } else {
              throw new WalletError("SWITCH_NETWORK_FAILED", "Network mismatch. Please switch to Arbitrum Sepolia in your wallet.");
            }
          } catch (_addError) {
            throw new WalletError("SWITCH_NETWORK_FAILED", "Network mismatch. Please switch to Arbitrum Sepolia in your wallet.");
          }
        } else {
          throw new WalletError("SWITCH_NETWORK_FAILED", err.message || "Failed to switch network");
        }
      }
    },
    getAccount() {
      const account = wagmiGetAccount(wagmiConfig);
      return account.address ?? null;
    },
    getChainId() {
      return wagmiGetChainId(wagmiConfig);
    },
    async getBalance(address) {
      const targetAddress = address ?? this.getAccount();
      if (!targetAddress) {
        throw new WalletError("NOT_CONNECTED", "Wallet not connected. Connect wallet first.");
      }
      try {
        return await getPublicClient(config).getBalance({
          address: targetAddress
        });
      } catch (error) {
        throw new WalletError("BALANCE_FAILED", error.message || "Failed to get wallet balance");
      }
    },
    isConnected() {
      return wagmiGetAccount(wagmiConfig).status === "connected";
    },
    getJwt() {
      return null;
    },
    async login() {
      const account = this.getAccount();
      if (!account) {
        throw new WalletError("NOT_CONNECTED", "Wallet not connected. Connect wallet first.");
      }
      const baseUrl = config.apiBaseUrl;
      try {
        const nonceRes = await fetch(`${baseUrl}/auth/nonce/${account}`, { credentials: "include" });
        if (!nonceRes.ok) {
          throw new WalletError("NONCE_FAILED", `Failed to get nonce: ${nonceRes.status}`);
        }
        const { nonce, message } = await nonceRes.json();
        const signature = await wagmiSignMessage(wagmiConfig, { message });
        const chainId = this.getChainId();
        if (!chainId) {
          throw new WalletError("NOT_CONNECTED", "Wallet chain unavailable. Connect wallet first.");
        }
        const loginRes = await fetch(`${baseUrl}/auth/wallet-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            walletAddress: account,
            signature,
            nonce,
            chainId
          })
        });
        if (!loginRes.ok) {
          throw new WalletError("LOGIN_FAILED", `Authentication failed: ${loginRes.status}`);
        }
        const data = await loginRes.json();
        return {
          accessToken: data.accessToken,
          userId: data.userId,
          walletAddress: account
        };
      } catch (error) {
        if (error instanceof WalletError)
          throw error;
        throw new WalletError("LOGIN_FAILED", error.message || "Login failed");
      }
    },
    async logout() {
      try {
        await fetch(`${config.apiBaseUrl}/auth/logout`, { method: "POST", credentials: "include" });
      } catch {}
    },
    onChainChange(cb) {
      if (unwatchAccountFn) {
        unwatchAccountFn();
        unwatchAccountFn = null;
      }
      if (unwatchChainFn) {
        unwatchChainFn();
        unwatchChainFn = null;
      }
      unwatchAccountFn = watchAccount(wagmiConfig, {
        onChange(account) {
          cb({ account: account.address });
        }
      });
      unwatchChainFn = watchChainId(wagmiConfig, {
        onChange(chainId) {
          cb({ chainId });
        }
      });
      return () => {
        if (unwatchAccountFn) {
          unwatchAccountFn();
          unwatchAccountFn = null;
        }
        if (unwatchChainFn) {
          unwatchChainFn();
          unwatchChainFn = null;
        }
      };
    },
    async refreshJwt() {
      const result = await this.login();
      return result;
    }
  };
}

// src/hub.js
function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    errors.push("Config must be an object");
    return { valid: false, errors };
  }
  if (!config.apiBaseUrl || typeof config.apiBaseUrl !== "string") {
    errors.push("apiBaseUrl must be a valid URL string");
  }
  if (!config.chainId || typeof config.chainId !== "number") {
    errors.push("chainId must be a valid chain ID number");
  }
  if (!config.rpcUrl || typeof config.rpcUrl !== "string") {
    errors.push("rpcUrl must be a valid URL string");
  }
  return { valid: errors.length === 0, errors };
}
function buildPartialResult(adapters, errors, config) {
  const firstError = Object.values(errors).find(Boolean);
  return {
    ...adapters.wallet ? { wallet: adapters.wallet } : {},
    ...adapters.api ? { api: adapters.api } : {},
    ...adapters.contract ? { contract: adapters.contract } : {},
    ...adapters.fhe ? { fhe: adapters.fhe } : {},
    getState() {
      return {
        status: "error",
        data: {
          wallet: adapters.wallet ? {
            address: adapters.wallet.getAccount(),
            chainId: adapters.wallet.getChainId(),
            connected: adapters.wallet.isConnected(),
            hasJwt: !!adapters.wallet.getJwt()
          } : null,
          fhe: adapters.fhe ? {
            permitUnlocked: adapters.fhe.permitCheck().unlocked,
            permitSecondsLeft: adapters.fhe.permitCheck().secondsLeft
          } : null,
          config
        },
        error: firstError ? {
          code: firstError.code,
          message: firstError.message,
          source: firstError.source,
          recoverable: firstError.recoverable
        } : null
      };
    },
    error: firstError
  };
}
function createBridge(config = {}) {
  const mergedConfig = createConfig(config);
  const validation = validateConfig(mergedConfig);
  if (!validation.valid) {
    const configError = new BridgeError("CONFIG_VALIDATION_FAILED", `Invalid bridge configuration: ${validation.errors.join("; ")}`, "config", false);
    return buildPartialResult({}, { config: configError }, mergedConfig);
  }
  const adapters = {};
  const initErrors = {};
  try {
    adapters.wallet = createWalletAdapter(mergedConfig);
  } catch (err) {
    initErrors.wallet = err instanceof BridgeError ? err : new BridgeError("WALLET_INIT_FAILED", err.message || "Failed to initialize wallet adapter", "wallet", true);
    return buildPartialResult(adapters, initErrors, mergedConfig);
  }
  try {
    adapters.api = createApiAdapter(mergedConfig, adapters.wallet);
  } catch (err) {
    initErrors.api = err instanceof BridgeError ? err : new BridgeError("API_INIT_FAILED", err.message || "Failed to initialize API adapter", "api", false);
    return buildPartialResult(adapters, initErrors, mergedConfig);
  }
  try {
    adapters.fhe = createFheAdapter(mergedConfig);
  } catch (err) {
    initErrors.fhe = err instanceof BridgeError ? err : new BridgeError("FHE_INIT_FAILED", err.message || "Failed to initialize FHE adapter", "cofhe", true);
    return buildPartialResult(adapters, initErrors, mergedConfig);
  }
  try {
    adapters.contract = createContractAdapter(mergedConfig, { apiAdapter: adapters.api, fheAdapter: adapters.fhe });
  } catch (err) {
    initErrors.contract = err instanceof BridgeError ? err : new BridgeError("CONTRACT_INIT_FAILED", err.message || "Failed to initialize contract adapter", "contract", false);
    return buildPartialResult(adapters, initErrors, mergedConfig);
  }
  try {
    adapters.wallet.onChainChange((data) => {
      if (data.account) {
        adapters.wallet?.logout().catch(() => {});
      }
    });
  } catch (_err) {}
  return {
    wallet: adapters.wallet,
    api: adapters.api,
    contract: adapters.contract,
    fhe: adapters.fhe,
    getState() {
      const w = adapters.wallet;
      const f = adapters.fhe;
      return {
        status: "success",
        data: {
          wallet: {
            address: w.getAccount(),
            chainId: w.getChainId(),
            connected: w.isConnected(),
            hasJwt: !!w.getJwt()
          },
          fhe: {
            permitUnlocked: f.permitCheck().unlocked,
            permitSecondsLeft: f.permitCheck().secondsLeft
          },
          config: mergedConfig
        },
        error: null
      };
    }
  };
}
export {
  createConfig,
  createBridge,
  WalletError,
  FheError,
  DEFAULT_CONFIG,
  ContractError,
  BridgeError,
  ApiError
};

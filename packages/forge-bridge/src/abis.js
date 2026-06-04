// @generated - Generated from contracts/out/*.json compiled output
// biome-ignore format: generated file, large ABI arrays
// @ts-nocheck - Large static ABI arrays; viem compatibility handled via type assertion

/** @type {import('./types.js').ContractAbiMap} */
export const CONTRACT_ABIS = {
  LendingPool: [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "COMMIT_DEADLINE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FLASH_FEE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LIQUIDATION_BONUS_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LIQUIDATION_CLOSE_FACTOR_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REVEAL_COOLDOWN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "borrowFor",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "handle",
        "type": "bytes32",
        "internalType": "euint128"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "borrowWithLtvCheck",
    "inputs": [
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "borrowToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "borrowAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encBorrowAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "ltvNum",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "ltvDen",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [
      {
        "name": "actual",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "borrowWithOracle",
    "inputs": [
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "borrowToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encBorrowAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "actual",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "commitBorrow",
    "inputs": [
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "borrowToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "encBorrowAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "ltvNum",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "ltvDen",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "composer",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "depositFor",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "handle",
        "type": "bytes32",
        "internalType": "euint128"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "disableOracle",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "disableWeth",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeBorrow",
    "inputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "actual",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeRepay",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeShield",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeShieldEth",
    "inputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeWithdraw",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "executeWithdrawEth",
    "inputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "flashFee",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "fee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "flashLoan",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "params",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "success",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getBorrowBalance",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "bal",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getSupplyBalance",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "bal",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "isLiquidatable",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "debtToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "liquidatable",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastRevealTime",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidReserve",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidateWithProof",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "debtToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "debtToCover",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "debtBalanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "debtSig",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "supplyBalanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "supplySig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "maxFlashLoan",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "maxLoan",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracle",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract PriceOracle"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "partialUnshield",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "partialUnshieldEth",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "repay",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "repayDebt",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "repayFor",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "handle",
        "type": "bytes32",
        "internalType": "euint128"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "requestBalanceReveal",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "requestBorrowReveal",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "requestUnshield",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "setComposer",
    "inputs": [
      {
        "name": "c",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "setOracle",
    "inputs": [
      {
        "name": "newOracle",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "setWeth",
    "inputs": [
      {
        "name": "newWeth",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "shield",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "shield",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "shieldEth",
    "inputs": [
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "shieldEth",
    "inputs": [
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "totalPlainBorrow",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unshieldWithProof",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "weth",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWETH9"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdrawEth",
    "inputs": [
      {
        "name": "encAmount",
        "type": "tuple",
        "internalType": "struct InEuint128",
        "components": [
          {
            "name": "ctHash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "securityZone",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "utype",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "commitId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdrawPausedWithProof",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balanceProof",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "balanceSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "event",
    "name": "BorrowCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "borrowToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Borrowed",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "borrowToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ComposerSet",
    "inputs": [
      {
        "name": "composer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FlashLoan",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Liquidated",
    "inputs": [
      {
        "name": "liquidator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "debtToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "debtCovered",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "collateralSeized",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OracleDisabled",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OracleSet",
    "inputs": [
      {
        "name": "oracle",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PausedWithdrawn",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Repaid",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RepayCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ShieldCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ShieldEthCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Supplied",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UnshieldRequested",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WethDisabled",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WethSet",
    "inputs": [
      {
        "name": "weth",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WithdrawCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WithdrawEthCommitted",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "commitId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CannotSelfLiquidate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CommitmentExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CommitmentNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FlashLoanNotRepaid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FlashLoanUnsupportedToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientCollateral",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientReserve",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEncryptedInput",
    "inputs": [
      {
        "name": "got",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "expected",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LiquidationTooLarge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LtvDenominatorZero",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LtvExceedsHundredPercent",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LtvNumeratorZero",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAuthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotComposer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OracleNotSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RevealCooldown",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ValueMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WethNotSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
],
  StrategyVault: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REGISTRY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addCollateral",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "bytes32",
        "internalType": "euint128"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "closePosition",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encCollateralAmount",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getCollateral",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "coll",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getDepositedAmount",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getPositionMeta",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "createdAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserPositions",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "ids",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openPosition",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encAmount",
        "type": "bytes32",
        "internalType": "euint128"
      },
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionOwner",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawPaused",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "CollateralAdded",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PausedWithdrawn",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PositionClosed",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "fullClose",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PositionOpened",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "strategyId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExceedsDeposit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidStrategyId",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPosition",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPositionOwner",
    "inputs": [
      {
        "name": "positionId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PositionNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SameBlockClose",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
],
  Composer: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "pool_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "router_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POOL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILendingPool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REGISTRY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROUTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISwapRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VAULT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IStrategyVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "openPosition",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct FheForgeComposer.OpenStrategyParams",
        "components": [
          {
            "name": "strategyName",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "workflowHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "collateralAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "poolSupplyAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "poolBorrowAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapDeadlineOffset",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "strategyId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapAmountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "swapMinOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "collateralToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "borrowToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "swapTokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ltvNum",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "ltvDen",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "useOracleBorrow",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "apyTarget",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "loopCount",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "e",
        "type": "tuple",
        "internalType": "struct FheForgeComposer.OpenStrategyEncrypted",
        "components": [
          {
            "name": "collateral",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "supplyEnc",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "borrowEnc",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rebalance",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct FheForgeComposer.RebalanceParams",
        "components": [
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "collateralToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "addCollateralAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "repayAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "repayToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "newBorrowAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "borrowToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "useOracleBorrow",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "ltvNum",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "ltvDen",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "name": "e",
        "type": "tuple",
        "internalType": "struct FheForgeComposer.RebalanceEncrypted",
        "components": [
          {
            "name": "addCollateralEnc",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "repayEnc",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "newBorrowEnc",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sweepToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "LeveragedStrategyOpened",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "strategyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyRebalanced",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEncryptedInput",
    "inputs": [
      {
        "name": "got",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "expected",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
],
  SwapRouter: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "executor_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minDeadlineOffset_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxDeadlineOffset_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "executorRotationDelay_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "uniswapV3Router_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DEADLINE_OFFSET",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_DEADLINE_OFFSET",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROTATION_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "UNISWAP_V3_ROUTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptExecutor",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelIntent",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeIntent",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "outputAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getIntentMeta",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRole",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRoleEarliest",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeExecutor",
    "inputs": [
      {
        "name": "newExecutor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitSwapIntent",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadlineOffset",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapViaUniswapV3MultiHop",
    "inputs": [
      {
        "name": "path",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountOutMinimum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapViaUniswapV3Single",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amountOutMinimum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ExecutorProposed",
    "inputs": [
      {
        "name": "newExecutor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "earliest",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExecutorRotated",
    "inputs": [
      {
        "name": "previousExecutor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newExecutor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IntentCancelled",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IntentExecuted",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "outputAmount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IntentSubmitted",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UniswapV3MultiHopSwap",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UniswapV3SingleSwap",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DeadlineTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlineTooShort",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientOutput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IntentExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingRole",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotCreator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotExecutor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SameToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TimelockNotElapsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnknownIntent",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroOutput",
    "inputs": []
  }
],
  PriceOracle: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "pyth_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "defaultStaleThreshold_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEFAULT_STALE_THRESHOLD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_PYTH_EXP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PYTH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPyth"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD_DECIMALS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "batchSetSources",
    "inputs": [
      {
        "name": "feeds",
        "type": "tuple[]",
        "internalType": "struct PriceOracle.FeedInfo[]",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "staleThreshold",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "collateralFactorBps",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "convertFromUsd",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "usdWad",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "convertToUsd",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "usdWad",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPriceUsd",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "priceWad",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "updatedAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPriceWithFallback",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "priceWad",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPythUpdateFee",
    "inputs": [
      {
        "name": "updateData",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "feeAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isStale",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "stale",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSupported",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "supported",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isTokenRegistered",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastPriceUpdate",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidationThresholdBps",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "priceId",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registeredTokens",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "removeFallbackPrice",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "removeSource",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCollateralFactor",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "ltvBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "liqThresholdBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFallbackPrice",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSource",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "priceId_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "decimals_",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "threshold_",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setStalenessThreshold",
    "inputs": [
      {
        "name": "newThreshold",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "staleThreshold",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stalenessThreshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sweepEth",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address payable"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tokenDecimals",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updatePriceFeeds",
    "inputs": [
      {
        "name": "updateData",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "event",
    "name": "CollateralFactorSet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "ltvBps",
        "type": "uint16",
        "indexed": true,
        "internalType": "uint16"
      },
      {
        "name": "liqThresholdBps",
        "type": "uint16",
        "indexed": true,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FallbackPriceRemoved",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FallbackPriceSet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PythCacheUpdated",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "feePaid",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SourceSet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "tokenDecimals",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "staleThreshold",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SourcesBatchSet",
    "inputs": [
      {
        "name": "count",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StalenessThresholdUpdated",
    "inputs": [
      {
        "name": "oldThreshold",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "newThreshold",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBps",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NegativePrice",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPriceAvailable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPriceFeed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PythUpdateFeeMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflowedIntToUint",
    "inputs": [
      {
        "name": "value",
        "type": "int256",
        "internalType": "int256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeCastOverflowedUintDowncast",
    "inputs": [
      {
        "name": "bits",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UncertainPrice",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroPrice",
    "inputs": []
  }
],
  StrategyRegistry: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "vaultRotationDelay_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_NAME_LENGTH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_NAME_LENGTH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROTATION_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptVault",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "broadcastStrategy",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "destinationDomain",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "decrementTvl",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getEncryptedTvl",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "v",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getStrategyMeta",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "workflowHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "createdAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getStrategyParams",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "apyTarget",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "loopCount",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "idByContentHash",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "incrementTvl",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "bytes32",
        "internalType": "euint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "localDomain",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRole",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRoleEarliest",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeVault",
    "inputs": [
      {
        "name": "newVault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "receiveCrossChainStrategy",
    "inputs": [
      {
        "name": "sourceDomain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sourceStrategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "workflowHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "apyTarget",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "loopCount",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerStrategy",
    "inputs": [
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "workflowHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "apyTarget",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "loopCount",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerStrategy",
    "inputs": [
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "workflowHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setActive",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setVault",
    "inputs": [
      {
        "name": "v",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "strategyCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vaultAddress",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "CrossChainMessage",
    "inputs": [
      {
        "name": "destinationDomain",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payload",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyActiveSet",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": true,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StrategyRegistered",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TvlDecreased",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TvlIncreased",
    "inputs": [
      {
        "name": "strategyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultProposed",
    "inputs": [
      {
        "name": "newVault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "earliest",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultSet",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EmptyName",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FhePermissionDenied",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidStrategyId",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NameTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingRole",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyCreator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "StrategyAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StrategyInactive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TimelockNotElapsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VaultAlreadySet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroWorkflowHash",
    "inputs": []
  }
],
  StrategyExecutor: [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "pool_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "router_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ADD_COLLATERAL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "BORROW_LTV",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEPOSIT_VAULT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POOL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILendingPool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REPAY_DEBT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROUTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISwapRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SHIELD_SUPPLY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SWAP_INTENT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SWAP_UNISWAP_V3",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VAULT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IStrategyVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WITHDRAW_VAULT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkpoints",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "actionIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "completed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executePipeline",
    "inputs": [
      {
        "name": "strategyId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actions",
        "type": "tuple[]",
        "internalType": "struct StrategyExecutor.Action[]",
        "components": [
          {
            "name": "actionType",
            "type": "bytes4",
            "internalType": "bytes4"
          },
          {
            "name": "params",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "encAmount",
            "type": "tuple",
            "internalType": "struct InEuint128",
            "components": [
              {
                "name": "ctHash",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "securityZone",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "utype",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "completed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "resetCheckpoint",
    "inputs": [
      {
        "name": "strategyId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sweepToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ActionExecuted",
    "inputs": [
      {
        "name": "strategyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "actionType",
        "type": "bytes4",
        "indexed": true,
        "internalType": "bytes4"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PipelineExecuted",
    "inputs": [
      {
        "name": "strategyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "stepsCompleted",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "completed",
        "type": "bool",
        "indexed": true,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEncryptedInput",
    "inputs": [
      {
        "name": "got",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "expected",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnknownActionType",
    "inputs": [
      {
        "name": "actionType",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
],
  TokenRegistry: [
  {
    "type": "function",
    "name": "BPS_DEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WAD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "disableToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getBorrowableTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "result",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getCollateralTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "result",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLendableTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "result",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTokenCount",
    "inputs": [],
    "outputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isTokenEnabled",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "isPaused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registerToken",
    "inputs": [
      {
        "name": "info",
        "type": "tuple",
        "internalType": "struct TokenRegistry.TokenInfo",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ltvBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "liquidationBonusBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "isLendable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isBorrowable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isCollateral",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "pythPriceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "borrowCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "supplyCap",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tokenList",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokens",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "ltvBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "liquidationBonusBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "isLendable",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "isBorrowable",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "isCollateral",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "pythPriceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrowCap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "supplyCap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateTokenConfig",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "info",
        "type": "tuple",
        "internalType": "struct TokenRegistry.TokenInfo",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ltvBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "liquidationBonusBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "isLendable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isBorrowable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "isCollateral",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "pythPriceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "borrowCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "supplyCap",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenDisabled",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenRegistered",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenUpdated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EthTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardEnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCiphertext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SecurityZoneOutOfBounds",
    "inputs": [
      {
        "name": "value",
        "type": "int32",
        "internalType": "int32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
],
  ExecutorContract: [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approveToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeIntent",
    "inputs": [
      {
        "name": "router",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "outputAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawTokens",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "IntentExecuted",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "outputAmount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokensWithdrawn",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  }
],
};

export const CONTRACT_ADDRESSES = {
	LendingPool: "0xff687831dfD3657D6C6879403cE56f53518b378C",
	StrategyVault: "0xfCb89417e0a21813c84647614764e920bBdFEb94",
	Composer: "0xEab68D8Ee6DC5Ddc10293fF3B1bb21679d81dC8b",
	SwapRouter: "0x9C9bEb3d95184BbA11AfE1D973927562C8eb0409",
	PriceOracle: "0x46ef25fDd66Ce1A331942064Ef6879848621fBd9",
	StrategyRegistry: "0xB39E9B573b8f39fBc407f8F7d9F621481d3E12C8",
	StrategyExecutor: "0x03De449445c1c11d190b49bf9dBf98FCfC6b58D8",
	TokenRegistry: "0x68c6A763e85367c4964b36e207DaFfe745B1B980",
	ExecutorContract: "0x1bF7eb45695A4d9b83F5392F16DC262840B4A7d1",
};

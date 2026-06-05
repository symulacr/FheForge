#!/usr/bin/env node

/**
 * MC-29: Verify Railway Environment Variables
 * Checks if required backend environment variables are set
 */

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'FHENIX_RPC',
  'STRATEGY_VAULT_ADDRESS',
  'LENDING_POOL_ADDRESS',
  'STRATEGY_REGISTRY_ADDRESS',
  'PRICE_ORACLE_ADDRESS',
];

const optionalVars = ['MAX_LTV', 'EXCHANGE_RATE_WETH_USDC'];

console.log('Checking Railway environment variables...\n');

const missingRequired = [];
const missingOptional = [];

requiredVars.forEach((varName) => {
  if (!process.env[varName]) {
    missingRequired.push(varName);
  }
});

optionalVars.forEach((varName) => {
  if (!process.env[varName]) {
    missingOptional.push(varName);
  }
});

if (missingRequired.length === 0) {
  console.log('✅ All required environment variables are set');
} else {
  console.log('❌ Missing required variables:', missingRequired.join(', '));
}

if (missingOptional.length > 0) {
  console.log('⚠️  Missing optional variables:', missingOptional.join(', '));
} else {
  console.log('✅ All optional environment variables are set');
}

if (missingRequired.length > 0) {
  process.exit(1);
}

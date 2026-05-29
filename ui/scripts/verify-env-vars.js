#!/usr/bin/env node

/**
 * MC-30: Verify Vercel Environment Variables
 * Checks if required frontend environment variables are set
 */

const requiredVars = [
	"NEXT_PUBLIC_VAULT_ADDRESS",
	"NEXT_PUBLIC_POOL_ADDRESS",
	"NEXT_PUBLIC_SWAP_ROUTER_ADDRESS",
	"NEXT_PUBLIC_REGISTRY_ADDRESS",
	"NEXT_PUBLIC_COMPOSER_ADDRESS",
	"NEXT_PUBLIC_ORACLE_ADDRESS",
	"NEXT_PUBLIC_CHAIN_ID",
];

const optionalVars = [
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	"NEXT_PUBLIC_API_URL",
	"NEXT_PUBLIC_SITE_URL",
];

console.log("Checking Vercel environment variables...\n");

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
	console.log("✅ All required environment variables are set");
} else {
	console.log("❌ Missing required variables:", missingRequired.join(", "));
}

if (missingOptional.length > 0) {
	console.log("⚠️  Missing optional variables:", missingOptional.join(", "));
} else {
	console.log("✅ All optional environment variables are set");
}

if (missingRequired.length > 0) {
	process.exit(1);
}

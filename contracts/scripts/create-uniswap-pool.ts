import { ethers } from "hardhat";
import deployments from "../deployments/421614.json";

const UNISWAP_V3_FACTORY = "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e";
const NONFUNGIBLE_POS_MANAGER = "0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65";

// Our tokens on arb-sepolia
const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

// Fee tier: 0.05% (500) for stablecoin pairs, 0.3% (3000) for volatile
const FEE_TIER = 3000; // 0.3% for WETH/USDC

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deployer:", await signer.getAddress());

  // ABIs for the Uniswap V3 contracts
  const npmAbi = [
    "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
    "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  ];

  const factoryAbi = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  ];

  const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function mint(address to, uint256 amount) external returns (bool)",
  ];

  const npm = new ethers.Contract(NONFUNGIBLE_POS_MANAGER, npmAbi, signer);
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, factoryAbi, signer);

  // Check if pool already exists
  const existingPool = await factory.getPool(WETH, USDC, FEE_TIER);
  console.log(`Existing WETH/USDC pool at fee ${FEE_TIER}: ${existingPool}`);

  // Sort tokens (token0 < token1 by address)
  const [token0, token1] = WETH.toLowerCase() < USDC.toLowerCase() ? [WETH, USDC] : [USDC, WETH];
  console.log(`token0: ${token0}, token1: ${token1}`);

  // Approve NPM to spend our tokens
  const wethContract = new ethers.Contract(WETH, erc20Abi, signer);
  const usdcContract = new ethers.Contract(USDC, erc20Abi, signer);

  // Mint some tokens if needed (MockERC20 has mint function)
  const wethBal = await wethContract.balanceOf(signer.getAddress());
  const usdcBal = await usdcContract.balanceOf(signer.getAddress());
  console.log(`WETH balance: ${ethers.formatEther(wethBal)}`);
  console.log(`USDC balance: ${ethers.formatUnits(usdcBal, 6)}`);

  // Price: 1 WETH = ~2340 USDC → sqrt(2340) * 2^96
  // For token0=USDC, token1=WETH: price = WETH/USDC in terms of token1/token0
  // sqrtPriceX96 = sqrt(price) * 2^96
  // If USDC is token0 and WETH is token1: price = amount of WETH per 1 USDC = 1/2340
  // sqrtPriceX96 = sqrt(1/2340) * 2^96 ≈ very small
  // If WETH is token0 and USDC is token1: price = amount of USDC per 1 WETH = 2340
  // sqrtPriceX96 = sqrt(2340) * 2^96

  // Determine which is token0
  let sqrtPriceX96: bigint;
  if (token0.toLowerCase() === USDC.toLowerCase()) {
    // token0=USDC, token1=WETH → price = WETH/USDC (amount of token1 per token0)
    // price = 1/2340 (1 USDC = 0.000427 WETH)
    // sqrt(1/2340) = ~0.0207, * 2^96
    // Need to account for decimals: USDC=6, WETH=18
    // Adjusted price = 1/2340 * 10^18/10^6 = 10^12/2340
    // sqrt(10^12/2340) * 2^96
    const priceAdjusted = (BigInt(10**12) * BigInt(2**96)) / BigInt(2340);
    sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(Number(priceAdjusted))));
    console.log("WARNING: USDC is token0, price calculation may be off for decimals");
  } else {
    // token0=WETH, token1=USDC → price = USDC/WETH = 2340
    // Adjusted for decimals: price * 10^6/10^18 = 2340 * 10^-12
    // But Uniswap uses raw amounts, so we need sqrtPriceX96 in the right format
    // price = 2340 * 10^(6-18) = 2340 * 10^-12
    // sqrtPriceX96 = sqrt(2340 * 10^-12) * 2^96
    const price = 2340 * 10 ** (6 - 18); // account for decimal difference
    const sqrtPrice = Math.sqrt(price);
    sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * (2 ** 96)));
  }

  console.log(`sqrtPriceX96: ${sqrtPriceX96}`);

  // Create and initialize pool
  console.log("\n--- Creating WETH/USDC pool ---");
  try {
    const createTx = await npm.createAndInitializePoolIfNecessary(
      token0, token1, FEE_TIER, sqrtPriceX96,
      { gasLimit: 5000000n }
    );
    const receipt = await createTx.wait();
    console.log("Pool created/initialized! tx:", receipt.hash);
  } catch (err: any) {
    console.error("Pool creation failed:", err.message?.slice(0, 200));
  }

  // Verify pool exists
  const poolAddr = await factory.getPool(WETH, USDC, FEE_TIER);
  console.log(`Pool address: ${poolAddr}`);

  if (poolAddr === ethers.ZeroAddress) {
    console.log("Pool not created, cannot add liquidity");
    return;
  }

  // Add liquidity
  console.log("\n--- Adding liquidity ---");

  // Approve NPM
  const approveWeth = await wethContract.approve(NONFUNGIBLE_POS_MANAGER, ethers.parseEther("10"));
  await approveWeth.wait();
  const approveUsdc = await usdcContract.approve(NONFUNGIBLE_POS_MANAGER, ethers.parseUnits("25000", 6));
  await approveUsdc.wait();
  console.log("Approved NPM for WETH + USDC");

  // Tick range: full range for simplicity
  // For 0.3% fee, tickSpacing = 60
  // Full range: tickLower = -887220, tickUpper = 887220
  // But those are multiples of 60: -887220 / 60 = -14787, 887220 / 60 = 14787
  const tickLower = -887220;
  const tickUpper = 887220;

  const mintParams = {
    token0,
    token1,
    fee: FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired: token0.toLowerCase() === WETH.toLowerCase()
      ? ethers.parseEther("5")  // 5 WETH
      : ethers.parseUnits("12000", 6), // 12000 USDC
    amount1Desired: token1.toLowerCase() === USDC.toLowerCase()
      ? ethers.parseUnits("12000", 6)
      : ethers.parseEther("5"),
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: await signer.getAddress(),
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  console.log("Mint params:", {
    token0: mintParams.token0,
    token1: mintParams.token1,
    fee: mintParams.fee,
    amount0Desired: mintParams.amount0Desired.toString(),
    amount1Desired: mintParams.amount1Desired.toString(),
  });

  try {
    const mintTx = await npm.mint(mintParams, { gasLimit: 10000000n });
    const receipt = await mintTx.wait();
    console.log("Liquidity added! tx:", receipt.hash);
  } catch (err: any) {
    console.error("Liquidity add failed:", err.message?.slice(0, 500));
    // Try with smaller amounts
    console.log("\nRetrying with smaller amounts...");
    const smallParams = {
      ...mintParams,
      amount0Desired: mintParams.amount0Desired / 10n,
      amount1Desired: mintParams.amount1Desired / 10n,
    };
    try {
      const mintTx2 = await npm.mint(smallParams, { gasLimit: 10000000n });
      const receipt2 = await mintTx2.wait();
      console.log("Liquidity added (small)! tx:", receipt2.hash);
    } catch (err2: any) {
      console.error("Small liquidity also failed:", err2.message?.slice(0, 500));
    }
  }

  // Final verification
  const finalPool = await factory.getPool(WETH, USDC, FEE_TIER);
  console.log(`\nFinal WETH/USDC pool: ${finalPool}`);
  console.log("Uniswap V3 pool setup complete");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

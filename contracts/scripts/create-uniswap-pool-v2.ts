import { ethers } from "hardhat";

const UNISWAP_V3_FACTORY = "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e";
const NONFUNGIBLE_POS_MANAGER = "0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65";

const WETH = "0x84BddCAfaccbBDBc0e3F1CAcCDd352EBf5e40A32";
const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";

// 0.05% fee (500) — better for stablecoin-like pairs
const FEE_TIER = 500;

// USDC = token0 (address 0x1503... < 0x84Bd... = WETH)
// price = WETH per USDC adjusted for decimals = (1/2340) * 10^12
// sqrtPriceX96 = sqrt(price_adjusted) * 2^96
const SQRT_PRICE_X96 = 1637840684907908506550572597379072n;

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deployer:", await signer.getAddress());

  const npmAbi = [
    "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
    "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  ];

  const factoryAbi = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  ];

  const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
  ];

  const npm = new ethers.Contract(NONFUNGIBLE_POS_MANAGER, npmAbi, signer);
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, factoryAbi, signer);

  const [token0, token1] = [USDC, WETH]; // USDC < WETH alphabetically
  console.log(`token0=${token0}, token1=${token1}`);

  // Check existing pool
  const existingPool = await factory.getPool(token0, token1, FEE_TIER);
  console.log(`Existing pool at fee ${FEE_TIER}: ${existingPool}`);

  if (existingPool === ethers.ZeroAddress) {
    console.log("\n--- Creating pool with correct sqrtPriceX96 ---");
    const createTx = await npm.createAndInitializePoolIfNecessary(
      token0, token1, FEE_TIER, SQRT_PRICE_X96,
      { gasLimit: 5000000n }
    );
    const receipt = await createTx.wait();
    console.log("Pool created! tx:", receipt.hash);
  }

  const poolAddr = await factory.getPool(token0, token1, FEE_TIER);
  console.log(`Pool address: ${poolAddr}`);

  if (poolAddr === ethers.ZeroAddress) {
    console.log("Pool not created. Aborting.");
    return;
  }

  // Approve
  const wethContract = new ethers.Contract(WETH, erc20Abi, signer);
  const usdcContract = new ethers.Contract(USDC, erc20Abi, signer);

  // We need enough WETH — we only have 0.1 WETH from deployment
  // Let's mint more WETH (it's our MockERC20/WETH9)
  const weth9Abi = [
    "function deposit() external payable",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
  ];
  const weth9 = new ethers.Contract(WETH, weth9Abi, signer);
  // Deposit 0.05 ETH to get 0.05 WETH9 (we have 0.1 already from deploy)
  console.log("\n--- Wrapping ETH for liquidity ---");
  const depositTx = await weth9.deposit({ value: ethers.parseEther("0.05") });
  await depositTx.wait();

  const wethBal = await weth9.balanceOf(signer.getAddress());
  const usdcBal = await usdcContract.balanceOf(signer.getAddress());
  console.log(`WETH balance: ${ethers.formatEther(wethBal)}`);
  console.log(`USDC balance: ${ethers.formatUnits(usdcBal, 6)}`);

  // Approve NPM
  await weth9.approve(NONFUNGIBLE_POS_MANAGER, ethers.parseEther("0.1"));
  await usdcContract.approve(NONFUNGIBLE_POS_MANAGER, ethers.parseUnits("50000", 6));
  console.log("Approved NPM");

  // For 0.05% fee, tickSpacing = 10
  // Full range: tickLower = -887220, tickUpper = 887220 (must be multiples of 10)
  // Actually for 500 fee tier, tickSpacing = 10
  const tickLower = -887220;
  const tickUpper = 887220;

  // Provide small liquidity: 0.05 WETH + ~117 USDC (at 2340 price)
  const mintParams = {
    token0: USDC,
    token1: WETH,
    fee: FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired: ethers.parseUnits("120", 6),   // 120 USDC
    amount1Desired: ethers.parseEther("0.05"),       // 0.05 WETH
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: await signer.getAddress(),
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };

  console.log("\n--- Adding liquidity ---");
  try {
    const mintTx = await npm.mint(mintParams, { gasLimit: 10000000n });
    const receipt = await mintTx.wait();
    console.log("Liquidity added! tx:", receipt.hash);
  } catch (err: any) {
    console.error("Liquidity failed:", err.message?.slice(0, 500));
  }

  console.log("\n--- Done ---");
  console.log(`WETH/USDC pool at 0.05%: ${poolAddr}`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

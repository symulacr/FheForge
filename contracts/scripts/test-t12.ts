import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";

async function main() {
  const [d] = await ethers.getSigners(); const a = d.address;

  const USDC = "0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
  const dep = JSON.parse(fs.readFileSync("deployments/421614.json","utf8"));

  const reg = await ethers.getContractAt("StrategyRegistry", dep.contracts.StrategyRegistry, d);
  const vlt = await ethers.getContractAt("StrategyVault", dep.contracts.StrategyVault, d);
  const pol = await ethers.getContractAt("LendingPool", dep.contracts.LendingPool, d);
  const cmp = await ethers.getContractAt("FheForgeComposer", dep.contracts.FheForgeComposer, d);
  const tok = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function mint(address,uint256)"], USDC, d);

  let p=0,f=0;
  function Y(m:string,i?:string){p++;console.log(`  \u2713 ${m}${i?": "+i:""}`);}
  function N(m:string,i?:string){f++;console.log(`  \u2717 ${m}${i?": "+i:""}`);}

  console.log("\n\u2500\u2500 T1 Registry \u2500\u2500");
  try{const[o,v,s]=await Promise.all([reg.OWNER(),reg.vaultAddress(),reg.strategyCount()]);o.toLowerCase()===a.toLowerCase()?Y("OWNER",o):N("OWNER");v.toLowerCase()===dep.contracts.StrategyVault.toLowerCase()?Y("vaultAddr",v):N("vaultAddr");Y("strategyCount",s.toString())}catch(e:any){N("T1",e.message)}

  console.log("\n\u2500\u2500 T2 Register \u2500\u2500");
  let sid=0n;
  try{const ts=Date.now().toString();const wf=ethers.keccak256(ethers.toUtf8Bytes(ts));const tx=await reg.registerStrategy("W9-"+ts,wf);await tx.wait();sid=await reg.strategyCount();Y("registerStrategy","id="+sid)}catch(e:any){N("T2",e.message);console.log("SKIP");return}

  console.log("\n\u2500\u2500 T3 Mint \u2500\u2500");
  try{const b=await tok.balanceOf(a);if(b<10_000_000n){await(await tok.mint(a,10_000_000n)).wait();Y("mint","10M")}else Y("bal",b.toString());await(await tok.approve(dep.contracts.StrategyVault,ethers.MaxUint256)).wait();await(await tok.approve(dep.contracts.LendingPool,ethers.MaxUint256)).wait();await(await tok.approve(dep.contracts.FheForgeComposer,ethers.MaxUint256)).wait();Y("approvals")}catch(e:any){N("T3",e.message)}

  console.log("\n\u2500\u2500 T4 CoFHE \u2500\u2500");
  let cc:CofheClient|null=null;
  try{cc=createCofheClient(createCofheConfig({environment:"node",supportedChains:[arbSepolia]}));const{publicClient,walletClient}=await hre.cofhe.hardhatSignerAdapter(d);await cc.connect(publicClient,walletClient);await cc.permits.createSelf({issuer:a});Y("connected")}catch(e:any){N("T4",e.message);return}
  if(!cc)return;

  console.log("\n\u2500\u2500 T5 openPosition \u2500\u2500");
  try{const e=await cc.encryptInputs([Encryptable.uint128(5_000_000n)]).execute();const tx=await vlt["openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)"](USDC,5_000_000n,e[0],sid,a);const r=await tx.wait();Y("openPosition","gas="+r!.gasUsed);await vlt.hasPosition(a)?Y("hasPosition"):N("hasPosition")}catch(e:any){N("T5",e.message)}

  console.log("\n\u2500\u2500 T6 getCollateral \u2500\u2500");
  try{const c=await vlt.getCollateral.staticCall();Y("getCollateral",c.toString().slice(0,24))}catch(e:any){N("T6",e.message)}

  console.log("\n\u2500\u2500 T7 supplyToLending \u2500\u2500");
  try{const e=await cc.encryptInputs([Encryptable.uint64(3_000_000n)]).execute();await(await pol.supplyToLending(USDC,3_000_000n,e[0],a)).wait();const pb=await pol.getPlainSupplyBalance(USDC);pb>=3_000_000n?Y("supplyToLending",pb.toString()):N("supplyToLending","bal="+pb)}catch(e:any){N("T7",e.message)}

  console.log("\n\u2500\u2500 T8 borrowFromLending \u2500\u2500");
  try{const e=await cc.encryptInputs([Encryptable.uint64(500_000n)]).execute();await(await pol.borrowFromLending(USDC,500_000n,e[0],a)).wait();(await pol.getPlainBorrowBalance(USDC))>=500_000n?Y("borrowFromLending"):N("borrowFromLending")}catch(e:any){N("T8",e.message)}

  console.log("\n\u2500\u2500 T9 repayBorrow \u2500\u2500");
  try{const e=await cc.encryptInputs([Encryptable.uint64(500_000n)]).execute();await(await pol.repayBorrow(USDC,500_000n,e[0],a)).wait();Y("repayBorrow")}catch(e:any){N("T9",e.message)}

  console.log("\n\u2500\u2500 T10 withdraw \u2500\u2500");
  try{const e=await cc.encryptInputs([Encryptable.uint64(3_000_000n)]).execute();await(await pol.withdraw(USDC,3_000_000n,e[0])).wait();(await pol.getPlainSupplyBalance(USDC))===0n?Y("withdraw"):N("withdraw")}catch(e:any){N("T10",e.message)}

  console.log("\n\u2500\u2500 T11 closePosition \u2500\u2500");
  try{const d2=await vlt.getDepositedAmount();await(await vlt.closePosition(d2)).wait();!(await vlt.hasPosition(a))?Y("closePosition"):N("closePosition")}catch(e:any){N("T11",e.message)}

  console.log("\n\u2500\u2500 T12 Composer \u2500\u2500");
  try{const ts=Date.now().toString();const wf=ethers.keccak256(ethers.toUtf8Bytes(ts+ts));const sc=await cc.encryptInputs([Encryptable.uint128(2_000_000n),Encryptable.uint64(1_000_000n),Encryptable.uint64(0n)]).execute();
  const prm={strategyName:"C-"+ts,workflowHash:wf,collateralToken:USDC,collateralAmount:2_000_000n,poolSupplyAmount:1_000_000n,borrowToken:USDC,poolBorrowAmount:0n,useOracleBorrow:false,ltvNum:0n,ltvDen:0n,swapTokenOut:ethers.ZeroAddress,swapDeadlineOffset:0n,strategyId:0n,apyTarget:1000,loopCount:1,swapAmountIn:0n,swapMinOut:0n,collateralPermit:{amount:0n,deadline:0n,nonce:0n,signature:"0x"}};
  const enc={collateral:sc[0],supplyEnc:sc[1],borrowEnc:sc[2]};const tx=await cmp.openLeveragedStrategy(prm,enc);const r=await tx.wait();Y("openLeveragedStrategy","gas="+r!.gasUsed);await vlt.hasPosition(a)?Y("vault hasPosition"):N("vault hasPosition")}catch(e:any){N("T12",e.message)}

  console.log(`\n\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);console.log(`\u2502  PASS:${p.toString().padStart(3)}  FAIL:${f.toString().padStart(3)} \u2502`);console.log(`\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`);if(f>0)process.exit(1);
}
main().catch(e=>{console.error(e);process.exit(1)});

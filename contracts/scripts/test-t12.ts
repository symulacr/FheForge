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
  const tok = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function mint(address,uint256)"], USDC, d);

  let p=0,f=0;
  const Y=(m:string,i?:string)=>{p++;console.log("  ✓ "+m+(i?": "+i:""));};
  const N=(m:string,i?:string)=>{f++;console.log("  ✗ "+m+(i?": "+i:""));};

  const InE128Sel = "(uint256,uint8,uint8,bytes)";
  const InE64Sel = "(uint256,uint8,uint8,bytes)";

  console.log("
T1 Registry");
  try{const[o,v,s]=await Promise.all([reg.OWNER(),reg.vaultAddress(),reg.strategyCount()]);Y("OWNER");Y("vaultAddr");Y("strategyCount",s.toString())}catch(e:any){N("T1",e.message)}

  console.log("
T2 Register");
  let sid=0n;
  try{const ts=Date.now().toString();const wf=ethers.keccak256(ethers.toUtf8Bytes(ts));const tx=await reg.registerStrategy("W9-"+ts,wf);await tx.wait();sid=await reg.strategyCount();Y("registerStrategy","id="+sid)}catch(e:any){N("T2",e.message);return}

  console.log("
T3 Mint");
  try{const b=await tok.balanceOf(a);if(b<10_000_000n){await(await tok.mint(a,10_000_000n)).wait();Y("mint")}else Y("bal");await(await tok.approve(dep.contracts.StrategyVault,ethers.MaxUint256)).wait();await(await tok.approve(dep.contracts.LendingPool,ethers.MaxUint256)).wait();Y("approvals")}catch(e:any){N("T3",e.message)}

  console.log("
T4 CoFHE");
  let cc:CofheClient|null=null;
  try{cc=createCofheClient(createCofheConfig({environment:"node",supportedChains:[arbSepolia]}));const{publicClient,walletClient}=await hre.cofhe.hardhatSignerAdapter(d);await cc.connect(publicClient,walletClient);await cc.permits.createSelf({issuer:a});Y("connected")}catch(e:any){N("T4",e.message);return}

  console.log("
T5 openPosition");
  try{
    const e=await cc.encryptInputs([Encryptable.uint128(5_000_000n)]).execute();
    const fn=vlt.interface.getFunction("openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("openPosition",[USDC,5_000_000n,e[0],sid,a]);
    const tx=await d.sendTransaction({to:dep.contracts.StrategyVault,data});
    await tx.wait();
    Y("openPosition");
    await vlt.hasPosition(a)?Y("hasPosition"):N("hasPosition")
  }catch(e:any){N("T5",e.message)}

  console.log("
T6 getCollateral");
  try{const c=await vlt.getCollateral.staticCall();Y("getCollateral",c.toString().slice(0,24))}catch(e:any){N("T6",e.message)}

  console.log("
T7 supplyToLending");
  try{
    const e=await cc.encryptInputs([Encryptable.uint64(3_000_000n)]).execute();
    const fn=pol.interface.getFunction("supplyToLending(address,uint256,(uint256,uint8,uint8,bytes),address)");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("supplyToLending",[USDC,3_000_000n,e[0],a]);
    await(await d.sendTransaction({to:dep.contracts.LendingPool,data})).wait();
    (await pol.getPlainSupplyBalance(USDC))>=3_000_000n?Y("supplyToLending"):N("supplyToLending")
  }catch(e:any){N("T7",e.message)}

  console.log("
T8 borrowFromLending");
  try{
    const e=await cc.encryptInputs([Encryptable.uint64(500_000n)]).execute();
    const fn=pol.interface.getFunction("borrowFromLending(address,uint256,(uint256,uint8,uint8,bytes),address)");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("borrowFromLending",[USDC,500_000n,e[0],a]);
    await(await d.sendTransaction({to:dep.contracts.LendingPool,data})).wait();
    (await pol.getPlainBorrowBalance(USDC))>=500_000n?Y("borrowFromLending"):N("borrowFromLending")
  }catch(e:any){N("T8",e.message)}

  console.log("
T9 repayBorrow");
  try{
    const e=await cc.encryptInputs([Encryptable.uint64(500_000n)]).execute();
    const fn=pol.interface.getFunction("repayBorrow(address,uint256,(uint256,uint8,uint8,bytes),address)");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("repayBorrow",[USDC,500_000n,e[0],a]);
    await(await d.sendTransaction({to:dep.contracts.LendingPool,data})).wait();
    Y("repayBorrow")
  }catch(e:any){N("T9",e.message)}

  console.log("
T10 withdraw");
  try{
    const e=await cc.encryptInputs([Encryptable.uint64(3_000_000n)]).execute();
    const fn=pol.interface.getFunction("withdraw(address,uint256,(uint256,uint8,uint8,bytes))");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("withdraw",[USDC,3_000_000n,e[0]]);
    await(await d.sendTransaction({to:dep.contracts.LendingPool,data})).wait();
    (await pol.getPlainSupplyBalance(USDC))===0n?Y("withdraw"):N("withdraw")
  }catch(e:any){N("T10",e.message)}

  console.log("
T11 closePosition");
  try{
    const d2=await vlt.getDepositedAmount();
    const e=await cc.encryptInputs([Encryptable.uint128(d2)]).execute();
    const fn=vlt.interface.getFunction("closePosition(uint256,(uint256,uint8,uint8,bytes))");
    const iface=new ethers.Interface([fn.format("json")]);
    const data=iface.encodeFunctionData("closePosition",[d2,e[0]]);
    await(await d.sendTransaction({to:dep.contracts.StrategyVault,data})).wait();
    !(await vlt.hasPosition(a))?Y("closePosition"):N("closePosition")
  }catch(e:any){N("T11",e.message)}

  console.log("
T12 Composer");
  try{
    const Composer = await ethers.getContractAt("FheForgeComposer", dep.contracts.FheForgeComposer, d);
    const ts=Date.now().toString();
    const wf=ethers.keccak256(ethers.toUtf8Bytes(ts+ts));
    const sc=await cc.encryptInputs([Encryptable.uint128(2_000_000n),Encryptable.uint64(1_000_000n),Encryptable.uint64(0n)]).execute();
    const prm={
      strategyName:"C-"+ts,workflowHash:wf,collateralToken:USDC,collateralAmount:2_000_000n,
      poolSupplyAmount:1_000_000n,borrowToken:USDC,poolBorrowAmount:0n,useOracleBorrow:false,
      ltvNum:0n,ltvDen:0n,swapTokenOut:ethers.ZeroAddress,swapDeadlineOffset:0n,strategyId:0n,
      apyTarget:1000,loopCount:1,swapAmountIn:0n,swapMinOut:0n,
      collateralPermit:{amount:0n,deadline:0n,nonce:0n,signature:"0x"}
    };
    const enc={collateral:sc[0],supplyEnc:sc[1],borrowEnc:sc[2]};
    const tx=await Composer.openLeveragedStrategy(prm,enc);
    const r=await tx.wait();
    Y("openLeveragedStrategy","gas="+r!.gasUsed);
    await vlt.hasPosition(a)?Y("vault hasPosition"):N("vault hasPosition")
  }catch(e:any){N("T12",e.message)}

  console.log("
PASS:"+p+" FAIL:"+f);
  if(f>0)process.exit(1);
}
main().catch(e=>{console.error(e);process.exit(1)});

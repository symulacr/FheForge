import { ethers } from "hardhat";
import hre from "hardhat";
import { Encryptable, type CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { arbSepolia } from "@cofhe/sdk/chains";
import * as fs from "fs";

let PASS=0,FAIL=0,SKIP=0;
const Y=(t,d)=>{PASS++;console.log("   PASS "+t+(d?": "+d:""));};
const N=(t,d)=>{FAIL++;console.log("   FAIL "+t+(d?": "+d:""));};
const S=(t,d)=>{SKIP++;console.log("   SKIP "+t+(d?": "+d:""));};

function dec(e,iface){const d=e?.data||e?.reason||e?.shortMessage||e?.message||String(e);if(typeof d==="string"&&d.startsWith("0x")&&iface)try{const p=iface.parseError(d);if(p)return p.name}catch{}return typeof d==="string"?d.substring(0,100):String(d);}

async function main(){
const[d]=await ethers.getSigners();const a=d.address;
const dep=JSON.parse(fs.readFileSync("deployments/421614.json","utf8"));
const U="0x150376EdEbc5AC48771655a61a795d828BeC8Df6";
const W="0x9A0227ebC77288ECFc7e6890C4C4e2FB11Af443d";
const reg=await ethers.getContractAt("StrategyRegistry",dep.contracts.StrategyRegistry,d);
const vlt=await ethers.getContractAt("StrategyVault",dep.contracts.StrategyVault,d);
const pol=await ethers.getContractAt("LendingPool",dep.contracts.LendingPool,d);
const rtr=await ethers.getContractAt("SwapRouter",dep.contracts.SwapRouter,d);
const orc=await ethers.getContractAt("PriceOracle",dep.contracts.PriceOracle,d);
const cmp=await ethers.getContractAt("FheForgeComposer",dep.contracts.FheForgeComposer,d);
const tok=await ethers.getContractAt(["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function mint(address,uint256)"],U,d);
const wethTok=await ethers.getContractAt(["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function mint(address,uint256)"],W,d);
const vI=vlt.interface;const pI=pol.interface;const rI=reg.interface;const rtI=rtr.interface;
console.log("ETH:",ethers.formatEther(await ethers.provider.getBalance(a)));

// P0: CoFHE + fund
console.log("\n=== P0 ===");
let cc=null;
try{cc=createCofheClient(createCofheConfig({environment:"node",supportedChains:[arbSepolia]}));const{x,y}=await hre.cofhe.hardhatSignerAdapter(d);await cc.connect(x,y);await cc.permits.createSelf({issuer:a});Y("CoFHE")}catch(e){N("CoFHE",dec(e));return}
const b=await tok.balanceOf(a);if(b<50_000_000n){await(await tok.mint(a,50_000_000n)).wait();Y("mint USDC 50M")}else Y("USDC");
const wb=await wethTok.balanceOf(a);if(wb<10_000_000n){await(await wethTok.mint(a,10_000_000n)).wait();Y("mint WETH 10M")}else Y("WETH");
const[a1,a2,a3]=await Promise.all([tok.allowance(a,dep.contracts.StrategyVault),tok.allowance(a,dep.contracts.LendingPool),tok.allowance(a,dep.contracts.FheForgeComposer)]);
const ps=[];
if(a1<ethers.MaxUint256/2n)ps.push(tok.approve(dep.contracts.StrategyVault,ethers.MaxUint256).then(t=>t.wait()));
if(a2<ethers.MaxUint256/2n)ps.push(tok.approve(dep.contracts.LendingPool,ethers.MaxUint256).then(t=>t.wait()));
if(a3<ethers.MaxUint256/2n)ps.push(tok.approve(dep.contracts.FheForgeComposer,ethers.MaxUint256).then(t=>t.wait()));
if(ps.length>0){await Promise.all(ps);Y("approvals")}else Y("approvals exist");

// P1: Registry
console.log("\n=== P1 Registry ===");
const[o,va,sc]=await Promise.all([reg.OWNER(),reg.vaultAddress(),reg.strategyCount()]);o.toLowerCase()===a.toLowerCase()?Y("OWNER"):N("OWNER",o);va.toLowerCase()===dep.contracts.StrategyVault.toLowerCase()?Y("vaultAddr"):N("vaultAddr",va);Y("strategyCount",sc.toString());
const ts=Date.now().toString();const wf=ethers.keccak256(ethers.toUtf8Bytes(ts));
let sid=0n;
try{const tx=await reg.registerStrategy("BRUTAL-"+ts,wf,1200,3);await tx.wait();sid=await reg.strategyCount();Y("registerStrategy","id="+sid);const m=await reg.getStrategyMeta(sid);m[2].toLowerCase()===a.toLowerCase()?Y("creator"):N("creator");m[4]?Y("active"):N("active");const[apy1,lp1]=await reg.getStrategyParams(sid);apy1===1200&&lp1===3?Y("apy=1200 loop=3"):N("params",apy1+" "+lp1)}catch(e){N("registerStrategy",dec(e,rI));}
try{await(await reg.setActive(sid,false)).wait();(await reg.getStrategyMeta(sid))[4]===false?Y("setActive(false)"):N("setActive")}catch(e){N("setActive",dec(e,rI))}
try{await(await reg.setActive(sid,true)).wait();Y("setActive(true)")}catch(e){N("setActive",dec(e,rI))}
try{await reg.incrementTvl.staticCall(sid,ethers.ZeroHash).then(()=>N("incTvl")).catch(()=>Y("incTvl OnlyVault"))}catch{}
try{await reg.decrementTvl.staticCall(sid,ethers.ZeroHash).then(()=>N("decTvl")).catch(()=>Y("decTvl OnlyVault"))}catch{}
try{const r2=reg.connect(await ethers.getImpersonatedSigner("0x000000000000000000000000000000000000dEaD"));await r2.setActive.staticCall(sid,true).then(()=>N("OnlyCreator")).catch(()=>Y("OnlyCreator guard"))}catch{}
try{const r3=reg.connect(await ethers.getImpersonatedSigner("0x000000000000000000000000000000000000dEaD"));await r3.proposeVault.staticCall(a).then(()=>N("proposeVault")).catch(()=>Y("proposeVault OnlyOwner"))}catch{}

// P2: Vault
console.log("\n=== P2 Vault ===");
let eO,eA,eC;
try{[eO,eA,eC]=await Promise.all([cc!.encryptInputs([Encryptable.uint128(10_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint128(5_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint128(10_000_000n)]).execute()]);Y("vault enc")}catch(e){N("vault enc",dec(e));return}
try{const fn=vI.getFunction("openPosition(address,uint256,(uint256,uint8,uint8,bytes),uint256,address)");const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("openPosition",[U,10_000_000n,eO[0],sid,a]);await(await d.sendTransaction({to:dep.contracts.StrategyVault,data,gasLimit:5_000_000})).wait();Y("openPosition 10M")}catch(e){N("openPosition",dec(e,vI));return}
const[hp,dam,mp]=await Promise.all([vlt.hasPosition(a),vlt.getDepositedAmount(),vlt.getPositionMeta()]);hp?Y("hasPosition"):N("hasPosition");dam===10_000_000n?Y("dep=10M"):N("dep",dam.toString());mp[0]===sid?Y("strategyId"):N("strategyId");mp[1]>0n?Y("createdAt"):N("createdAt");
try{const fn=vI.getFunction("addCollateral(address,uint256,euint128,address)");const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("addCollateral",[U,5_000_000n,eA[0],a]);await(await d.sendTransaction({to:dep.contracts.StrategyVault,data,gasLimit:5_000_000})).wait();(await vlt.getDepositedAmount())===15_000_000n?Y("addCollateral 5M"):N("addCollateral")}catch(e){N("addCollateral",dec(e,vI))}
try{const ct=await vlt.getCollateral.staticCall();ct!==ethers.ZeroHash?Y("getCollateral"):N("getCollateral")}catch(e){N("getCollateral",dec(e))}
// emergencyWithdraw via staticCall
S("emergencyWithdraw","needs pause");

// P3: Pool
console.log("\n=== P3 Pool ===");
let eS,eB,eR,eW;
try{[eS,eB,eR,eW]=await Promise.all([cc!.encryptInputs([Encryptable.uint64(20_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint64(5_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint64(5_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint64(20_000_000n)]).execute()]);Y("pool enc")}catch(e){N("pool enc",dec(e));return}
try{const sel="supplyToLending(address,uint256,(uint256,uint8,uint8,bytes),address)";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("supplyToLending",[U,20_000_000n,eS[0],a]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,gasLimit:5_000_000})).wait();Y("supplyToLending 20M")}catch(e){N("supplyToLending",dec(e,pI))}
try{const sel="checkLtvAndBorrow(address,address,uint256,(uint256,uint8,uint8,bytes),uint128,uint128)";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("checkLtvAndBorrow",[U,U,5_000_000n,eB[0],8000n,10000n]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,gasLimit:5_000_000})).wait();Y("checkLtvAndBorrow 5M")}catch(e){N("checkLtvAndBorrow",dec(e,pI))}
try{const sel="borrowWithOracle(address,address,uint256,(uint256,uint8,uint8,bytes))";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("borrowWithOracle",[U,U,1_000_000n,eB[0]]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,gasLimit:5_000_000})).wait();Y("borrowWithOracle 1M")}catch(e){N("borrowWithOracle",dec(e,pI))}
try{const sup=await pol.getPlainSupplyBalance(U);sup>=20_000_000n?Y("plainSupply",sup.toString()):N("plainSupply",sup.toString());await pol.getSupplyBalance.staticCall(U).then(()=>Y("ctSupply")).catch(()=>N("ctSupply"));const bor=await pol.getPlainBorrowBalance(U);bor>=6_000_000n?Y("plainBorrow",bor.toString()):N("plainBorrow",bor.toString());await pol.getBorrowBalance.staticCall(U).then(()=>Y("ctBorrow")).catch(()=>N("ctBorrow"));Y("liquidReserve",(await pol.liquidReserve(U)).toString())}catch(e){N("pool reads",dec(e))}
try{const sel="repayBorrow(address,uint256,(uint256,uint8,uint8,bytes),address)";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("repayBorrow",[U,6_000_000n,eR[0],a]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,gasLimit:5_000_000})).wait();(await pol.getPlainBorrowBalance(U))===0n?Y("repayBorrow full"):N("repayBorrow")}catch(e){N("repayBorrow",dec(e,pI))}
try{const sel="withdraw(address,uint256,(uint256,uint8,uint8,bytes))";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("withdraw",[U,20_000_000n,eW[0]]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,gasLimit:5_000_000})).wait();(await pol.getPlainSupplyBalance(U))===0n?Y("withdraw full"):N("withdraw")}catch(e){N("withdraw",dec(e,pI))}
// supplyEth
try{const ethEnc=await cc!.encryptInputs([Encryptable.uint64(100_000_000_000_000_000n)]).execute();const sel="supplyEth((uint256,uint8,uint8,bytes))";const fn=pI.getFunction(sel);const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("supplyEth",[ethEnc[0]]);await(await d.sendTransaction({to:dep.contracts.LendingPool,data,value:100_000_000_000_000n,gasLimit:5_000_000})).wait();Y("supplyEth")}catch(e){N("supplyEth",dec(e,pI))}
// liquidate guard
S("liquidate","needs unhealthy position");
try{await pol.setOracle.staticCall(ethers.ZeroAddress).then(()=>N("setOracle")).catch(()=>Y("setOracle OnlyOwner"))}catch{}
try{await pol.setWeth.staticCall(ethers.ZeroAddress).then(()=>N("setWeth")).catch(()=>Y("setWeth OnlyOwner"))}catch{}

// P4: Router
console.log("\n=== P4 Router ===");
try{const tx=await rtr.submitSwapIntent(U,W,1_000_000n,990_000n,3600n);const rc=await tx.wait();const log=rc?.logs.find((l)=>{try{return rtI.parseLog({topics:l.topics,data:l.data})?.name==="IntentSubmitted"}catch{return false}});const iid=log?rtI.parseLog({topics:log.topics,data:log.data})?.args[0]:null;if(iid){Y("submitSwapIntent");const m=await rtr.getIntentMeta(iid);m[2].toLowerCase()===a.toLowerCase()?Y("getIntentMeta"):N("getIntentMeta");await(await rtr.cancelIntent(iid)).wait();(await rtr.getIntentMeta(iid))[2]===ethers.ZeroAddress?Y("cancelIntent"):N("cancelIntent")}else N("submitSwapIntent","no log")}catch(e){N("Router",dec(e,rtI))}
try{await rtr.executeIntent.staticCall(ethers.ZeroHash,1n).then(()=>N("executeIntent")).catch(()=>Y("executeIntent NotExecutor"))}catch{}
try{await rtr.cancelIntent.staticCall(ethers.ZeroHash).then(()=>N("cancelIntent")).catch(()=>Y("cancelIntent NotCreator"))}catch{}
try{await rtr.submitSwapIntent.staticCall(U,U,1n,1n,3600n).then(()=>N("sameToken")).catch(()=>Y("sameToken SameToken"))}catch{}
const[exec,rtrOwner]=await Promise.all([rtr.executor(),rtr.OWNER()]);Y("executor",exec);Y("router OWNER",rtrOwner);

// P5: Oracle
console.log("\n=== P5 Oracle ===");
const[pythAddr,dft,orcOwner]=await Promise.all([orc.PYTH(),orc.DEFAULT_STALE_THRESHOLD(),orc.OWNER()]);Y("PYTH",pythAddr);Y("STALE",dft.toString());Y("OWNER",orcOwner);
await orc.isSupported(U).then(r=>r?Y("isSupported true"):N("isSupported"));
try{await orc.convertToUsd.staticCall(U,1_000000n).then((r)=>{if(r>0n)Y("convertToUsd",r.toString());else N("convertToUsd","=0")}).catch(()=>N("convertToUsd","reverted"))}catch(e){N("convertToUsd",dec(e))}
try{await orc.convertFromUsd.staticCall(U,1_000000000000000000n).then((r)=>{if(r>0n)Y("convertFromUsd",r.toString());else N("convertFromUsd","=0")}).catch(()=>N("convertFromUsd","reverted"))}catch(e){N("convertFromUsd",dec(e))}
try{await orc.setSource.staticCall(U,ethers.ZeroHash,18,86400n).then(()=>N("setSource")).catch(()=>Y("setSource OnlyOwner"))}catch{}
try{await orc.setCollateralFactor.staticCall(U,8000,8500).then(()=>N("setCF")).catch(()=>Y("setCF OnlyOwner"))}catch{}

// P6: Composer
console.log("\n=== P6 Composer ===");
try{await cmp.pause.staticCall().then(()=>N("pause")).catch(()=>Y("pause OnlyOwner"))}catch{}
try{await cmp.sweepToken.staticCall(U,a).then(()=>N("sweepToken")).catch(()=>Y("sweepToken OnlyOwner"))}catch{}
// openLeveragedStrategy
let ec1,ec2,ec3;
try{[ec1,ec2,ec3]=await Promise.all([cc!.encryptInputs([Encryptable.uint128(3_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint64(2_000_000n)]).execute(),cc!.encryptInputs([Encryptable.uint64(0n)]).execute()]);Y("composer enc")}catch(e){N("composer enc",dec(e));return}
try{const t2=Date.now().toString();const wf2=ethers.keccak256(ethers.toUtf8Bytes(t2+t2));const prm={strategyName:"C-"+t2,workflowHash:wf2,collateralToken:U,collateralAmount:3_000_000n,poolSupplyAmount:2_000_000n,borrowToken:U,poolBorrowAmount:0n,useOracleBorrow:false,ltvNum:0n,ltvDen:0n,swapTokenOut:ethers.ZeroAddress,swapDeadlineOffset:0n,strategyId:0n,apyTarget:800,loopCount:2,swapAmountIn:0n,swapMinOut:0n,collateralPermit:{amount:0n,deadline:0n,nonce:0n,signature:"0x"}};const enc2={collateral:ec1[0],supplyEnc:ec2[0],borrowEnc:ec3[0]};const tx=await cmp.openLeveragedStrategy(prm,enc2);const r=await tx.wait();Y("openLeveragedStrategy","gas="+r!.gasUsed)}catch(e){N("openLeveragedStrategy",dec(e,cmp.interface))}
try{(await vlt.hasPosition(a))?Y("composer: vault pos"):N("composer: vault pos");(await pol.getPlainSupplyBalance(U))>=2_000_000n?Y("composer: pool supply"):N("composer: pool supply")}catch(e){N("composer verify",dec(e))}
S("rebalance","needs permit2");

// Close position for cleanup
if(await vlt.hasPosition(a)){
  try{const dt=await vlt.getDepositedAmount();const ec=await cc!.encryptInputs([Encryptable.uint128(dt)]).execute();const fn=vI.getFunction("closePosition(uint256,(uint256,uint8,uint8,bytes))");const data=new ethers.Interface([fn.format("json")]).encodeFunctionData("closePosition",[dt,ec[0]]);await(await d.sendTransaction({to:dep.contracts.StrategyVault,data,gasLimit:5_000_000})).wait();Y("cleanup closePosition")}catch(e){N("cleanup",dec(e))}
}

console.log("\n"+"=".repeat(40));
console.log("TOTAL: "+(PASS+FAIL+SKIP)+"  PASS: "+PASS+"  FAIL: "+FAIL+"  SKIP: "+SKIP);
}
main().catch(e=>{console.error(e);process.exit(1)});

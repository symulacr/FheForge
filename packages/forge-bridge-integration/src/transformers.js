/* ──────────────────────────────────────────────
   Transformers — Pure functions that map
   bridge adapter data shapes → forge mock-compatible shapes.
   All functions are side-effect-free and browser-compatible.
   ────────────────────────────────────────────── */

(() => {
	var transformers = {};

	/* ──────────────────────────────────────────────
     Module-level constants — created once,
     shared across all transformer calls.
     ────────────────────────────────────────────── */

	var ACTION_MAP = {
		supply: {
			label: "Supply",
			kicker: "SUP",
			swatch: "#22c55e",
			desc: "Supply assets to lending pool",
		},
		borrow: {
			label: "Borrow",
			kicker: "BRW",
			swatch: "#eab308",
			desc: "Borrow assets from lending pool",
		},
		swap: { label: "Swap", kicker: "SWP", swatch: "#3b82f6", desc: "Swap tokens via DEX" },
		repeat: { label: "Repeat", kicker: "RPT", swatch: "#888888", desc: "Repeat previous action" },
		settle: { label: "Settle", kicker: "STL", swatch: "#ef4444", desc: "Settle/repay position" },
	};

	/* ──────────────────────────────────────────────
     transformMarkets
     API /markets → forge L_MARKETS format
     ────────────────────────────────────────────── */
	function transformMarkets(apiMarkets) {
		if (!Array.isArray(apiMarkets)) return [];
		return apiMarkets.map((m) => {
			var utilization = m.util ?? m.utilization;
			var liq = m.liq ?? m.liquidationThreshold;
			return {
				asset: m.asset || m.symbol || "UNKNOWN",
				assetAddress: m.assetAddress || null,
				supplyApy: formatApy(
					m.supplyAPY != null ? m.supplyAPY : m.supplyRate != null ? m.supplyRate : m.supplyApy,
				),
				borrowApy: formatApy(
					m.borrowAPY != null ? m.borrowAPY : m.borrowRate != null ? m.borrowRate : m.borrowApy,
				),
				util: formatPercentValue(utilization),
				tvl: formatUsdDisplay(
					m.tvl != null ? m.tvl : m.totalSupplyUsd != null ? m.totalSupplyUsd : m.totalSupply,
				),
				liq: formatPercentValue(liq),
				oracle: m.oracle || m.oracleSource || (m.oraclePrice != null ? "on-chain" : "unavailable"),
				price: m.price || formatUsdDisplay(m.oraclePrice),
				totalBorrowed: formatUsdDisplay(m.totalBorrowed) || m.totalBorrowed || null,
				totalSupplied: formatUsdDisplay(m.totalSupplied) || m.totalSupplied || null,
				healthAfterSupply: m.healthAfterSupply,
				healthAfterBorrow: m.healthAfterBorrow,
				healthFactor: m.healthFactor ?? null,
				liqPrice: m.liqPrice ?? m.liquidationPrice ?? null,
				estimatedGas: m.estimatedGas,
				updatedAt: m.updatedAt || m.oracleUpdatedAt,
			};
		});
	}

	/* ──────────────────────────────────────────────
     transformPositions
     Supply/borrow objects → forge D_POSITIONS format
     ────────────────────────────────────────────── */
	function transformPositions(supplies, borrows, markets) {
		var positions = [];
		if (Array.isArray(supplies)) {
			supplies.forEach((s) => {
				positions.push({
					id: s.id || `sup-${s.asset || Math.random().toString(36).slice(2, 8)}`,
					venue: "Lending Pool",
					asset: s.asset || "UNKNOWN",
					tokenAddress: s.tokenAddress || s.token || s.assetAddress || null,
					side: "supply",
					amount: s.amountUsd || s.amount || "0",
					amountWei: s.amountWei || s.rawAmount || s.balanceWei || null,
					decimals: s.decimals || s.tokenDecimals || null,
					apy: lookupApy(markets, s.asset, "supply"),
					liq: s.liquidationThreshold || "0",
				});
			});
		}
		if (Array.isArray(borrows)) {
			borrows.forEach((b) => {
				positions.push({
					id: b.id || `bor-${b.asset || Math.random().toString(36).slice(2, 8)}`,
					venue: "Lending Pool",
					asset: b.asset || "UNKNOWN",
					tokenAddress: b.tokenAddress || b.token || b.assetAddress || null,
					side: "borrow",
					amount: b.amountUsd || b.amount || "0",
					amountWei: b.amountWei || b.rawAmount || b.balanceWei || null,
					decimals: b.decimals || b.tokenDecimals || null,
					apy: lookupApy(markets, b.asset, "borrow"),
					liq: b.liquidationThreshold || "0",
				});
			});
		}
		return positions;
	}

	/* ──────────────────────────────────────────────
     transformVaultPositions
     API vault positions → forge-compatible shape
     ────────────────────────────────────────────── */
	function transformVaultPositions(apiVaultPositions) {
		if (!Array.isArray(apiVaultPositions)) return [];
		return apiVaultPositions.map((v) => ({
			id: v.id || v.vaultId || `vault-${Math.random().toString(36).slice(2, 8)}`,
			vaultAddress: v.vaultAddress || v.address || null,
			name: v.name || v.vaultName || "Vault",
			asset: v.asset || v.depositAsset || "UNKNOWN",
			depositedAmount: v.depositedAmount || v.amount || "0",
			depositedUsd: v.depositedUsd || v.amountUsd || "0",
			shares: v.shares || v.shareBalance || "0",
			apy: v.apy || 0,
			strategy: v.strategy || v.strategyName || "",
			pendingRewards: v.pendingRewards || "0",
		}));
	}

	/* ──────────────────────────────────────────────
     transformActivities
     API events → forge D_ACTIVITY format
     ────────────────────────────────────────────── */
	function transformActivities(apiActivities) {
		if (!Array.isArray(apiActivities)) return [];
		return apiActivities.map((a) => ({
			id: a.id || a.txHash || `act-${Math.random().toString(36).slice(2, 8)}`,
			block: a.blockNumber != null ? String(a.blockNumber) : "",
			age: relativeTime(a.timestamp || a.createdAt),
			what: a.description || a.type || "Transaction",
			kind: a.kind || a.action || "swapped",
			asset: a.asset || a.token || "",
			delta: formatDelta(a.amount, a.side),
		}));
	}

	/* ──────────────────────────────────────────────
     formatTicker
     Stats → 9 formatted ticker strings
     ────────────────────────────────────────────── */
	function formatTicker(stats) {
		var s = stats || {};
		var poolTvls = s.poolTvls || {};
		return [
			`TVL: ${formatUsdDisplay(s.tvlUsd)}`,
			`MARKETS: ${s.activeMarkets != null ? s.activeMarkets : "—"}`,
			`STRATS: ${s.activeStrategies != null ? s.activeStrategies : "—"}`,
			`DEPLOYS: ${s.totalDeployments != null ? s.totalDeployments : "—"}`,
			`ENCRYPTED: ${s.encryptedOps != null ? s.encryptedOps : "—"}`,
			`PERMITS: ${s.permitDecryptsDay != null ? s.permitDecryptsDay : "—"}`,
			`USDC TVL: ${formatUsdDisplay(poolTvls.USDC)}`,
			`ETH TVL: ${formatUsdDisplay(poolTvls.ETH)}`,
			`STATUS: ${s.status || "unavailable"}`,
		];
	}

	/* ──────────────────────────────────────────────
     transformStrategies
     API defi-strategies → forge D_STRATS format
     ────────────────────────────────────────────── */
	function transformStrategies(apiStrategies) {
		if (!Array.isArray(apiStrategies)) return [];
		return apiStrategies.map((s) => ({
			id: s.id || s.strategyId || `strat-${Math.random().toString(36).slice(2, 8)}`,
			name: s.name || "Strategy",
			apy: formatApy(s.apy || s.estimatedApy),
			staked: s.totalStakedUsd || s.staked || "0",
			loops: s.loopCount || s.loops || 0,
			last: relativeTime(s.lastUpdated || s.updatedAt || s.createdAt),
		}));
	}

	/* ──────────────────────────────────────────────
     transformProposals
     Governance API → forge PROPOSALS format
     ────────────────────────────────────────────── */
	function transformProposals(apiProposals) {
		if (!Array.isArray(apiProposals)) return [];
		return apiProposals.map((p) => ({
			id: p.id || p.proposalId || `prop-${Math.random().toString(36).slice(2, 8)}`,
			title: p.title || "Proposal",
			status: (p.status || "pending").toLowerCase(),
			body: p.description || p.body || "",
			forVotes:
				p.forVotes != null ? String(p.forVotes) : p.votesFor != null ? String(p.votesFor) : "0",
			againstVotes:
				p.againstVotes != null
					? String(p.againstVotes)
					: p.votesAgainst != null
						? String(p.votesAgainst)
						: "0",
			abstain: p.abstainVotes != null ? String(p.abstainVotes) : "0",
			quorum: p.quorum ? String(p.quorum) : "0",
			timeLeft: p.deadline ? relativeTime(p.deadline) : p.endsAt ? relativeTime(p.endsAt) : "—",
			proposer: p.proposer || p.creator || "0x0000",
		}));
	}

	/* ──────────────────────────────────────────────
     transformCommunity
     API community strategies → forge COMMUNITY format
     ────────────────────────────────────────────── */
	function transformCommunity(apiCommunity) {
		if (!Array.isArray(apiCommunity)) return [];
		return apiCommunity.map((item) => ({
			id: item.id || item.strategyId || `comm-${Math.random().toString(36).slice(2, 8)}`,
			name: item.name || item.strategistName || "Strategy",
			author: item.author || item.strategistHandle || item.strategistName || "anonymous",
			risk: (item.risk || "medium").toLowerCase(),
			apy: item.apy || item.estimatedApy || 0,
			tvl: item.tvl || item.totalStakedUsd || "0",
			asset: item.asset || item.token || "UNKNOWN",
			deployers: item.deployers || item.deployerCount || 0,
			template: item.template || item.templateId || "",
		}));
	}

	/* ──────────────────────────────────────────────
     transformNodeTypes
     Defi modules → node type definition map
     ────────────────────────────────────────────── */
	function transformNodeTypes(modules) {
		if (!Array.isArray(modules)) {
			return defaultNodeTypes();
		}
		var nodeTypes = {};
		modules.forEach((m) => {
			var action = (m.action || m.type || "").toLowerCase();
			if (ACTION_MAP[action]) {
				// Use object spread to avoid Object.assign intermediate allocation
				nodeTypes[m.id || action] = {
					...ACTION_MAP[action],
					protocol: m.protocol || m.name || "",
				};
			}
		});
		// Ensure defaults exist
		const keys = Object.keys(ACTION_MAP);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!Object.values(nodeTypes).some((n) => n.kicker === ACTION_MAP[k].kicker)) {
				// Use object spread instead of Object.assign({}, ...) to avoid
				// creating both an empty object and a copy
				nodeTypes[k] = { ...ACTION_MAP[k] };
			}
		}
		return nodeTypes;
	}

	/* ──────────────────────────────────────────────
     Portfolio metrics
     ────────────────────────────────────────────── */
	function calculateNetValue(positions) {
		if (!Array.isArray(positions) || positions.length === 0) return "0.00";
		var total = 0;
		for (let i = 0; i < positions.length; i++) {
			const amt = parseUsd(positions[i].amount);
			if (positions[i].side === "borrow") {
				total -= amt;
			} else {
				total += amt;
			}
		}
		return total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	function calculateLTV(positions) {
		if (!Array.isArray(positions) || positions.length === 0)
			return { ratio: "0.00", gaugeValue: 0 };
		var totalSupply = 0;
		var totalBorrow = 0;
		for (let i = 0; i < positions.length; i++) {
			const amt = parseUsd(positions[i].amount);
			if (positions[i].side === "borrow") {
				totalBorrow += amt;
			} else {
				totalSupply += amt;
			}
		}
		if (totalSupply === 0) return { ratio: "0.00", gaugeValue: 0 };
		var ratio = (totalBorrow / totalSupply) * 100;
		return {
			ratio: ratio.toFixed(2),
			gaugeValue: Math.min(Math.round(ratio), 100),
		};
	}

	/* ──────────────────────────────────────────────
     Internal helpers
     ────────────────────────────────────────────── */

	function formatApy(val) {
		if (val == null) return "—";
		var num = typeof val === "string" ? parseFloat(val) : val;
		if (Number.isNaN(num)) return "—";
		// Backend returns decimal (0.065 = 6.5%). Multiply if ≤ 1, pass through if already > 1.
		return (num <= 1 ? num * 100 : num).toFixed(2);
	}

	function formatPercentValue(val) {
		if (val == null) return 0;
		var num = typeof val === "string" ? parseFloat(val) : val;
		if (Number.isNaN(num)) return 0;
		return Math.round(num > 0 && num <= 1 ? num * 100 : num);
	}

	function formatUsdDisplay(val) {
		if (val == null) return "unavailable";
		var num = typeof val === "string" ? parseFloat(String(val).replace(/[$,]/g, "")) : val;
		if (Number.isNaN(num)) return String(val);
		return `$${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
	}

	function parseUsd(val) {
		if (val == null) return 0;
		if (typeof val === "number") return val;
		var cleaned = String(val).replace(/[$,]/g, "");
		var num = parseFloat(cleaned);
		return Number.isNaN(num) ? 0 : num;
	}

	function relativeTime(timestamp) {
		if (!timestamp) return "—";
		var now = Date.now();
		var then = new Date(timestamp).getTime();
		if (Number.isNaN(then)) return String(timestamp);
		var diff = now - then;
		var seconds = Math.floor(diff / 1000);
		if (seconds < 0) return "0s";
		if (seconds < 60) return `${seconds}s`;
		var minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		var hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		var days = Math.floor(hours / 24);
		return `${days}d`;
	}

	function formatDelta(amount, side) {
		if (amount == null) return "";
		var prefix = side === "borrow" || side === "withdraw" ? "-" : "+";
		var num = typeof amount === "string" ? parseUsd(amount) : amount;
		if (typeof num === "number") {
			return (
				prefix + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
			);
		}
		return prefix + String(amount);
	}

	function lookupApy(markets, asset, side) {
		if (!Array.isArray(markets) || !asset) return "—";
		for (let i = 0; i < markets.length; i++) {
			const m = markets[i];
			if ((m.asset || m.symbol) === asset) {
				const raw =
					side === "supply"
						? m.supplyAPY != null
							? m.supplyAPY
							: m.supplyRate != null
								? m.supplyRate
								: m.supplyApy
						: m.borrowAPY != null
							? m.borrowAPY
							: m.borrowRate != null
								? m.borrowRate
								: m.borrowApy;
				return formatApy(raw);
			}
		}
		return "—";
	}

	function defaultNodeTypes() {
		return {
			supply: {
				label: "Supply",
				kicker: "SUP",
				swatch: "#22c55e",
				desc: "Supply assets to lending pool",
				protocol: "",
			},
			borrow: {
				label: "Borrow",
				kicker: "BRW",
				swatch: "#eab308",
				desc: "Borrow assets from lending pool",
				protocol: "",
			},
			swap: {
				label: "Swap",
				kicker: "SWP",
				swatch: "#3b82f6",
				desc: "Swap tokens via DEX",
				protocol: "",
			},
			repeat: {
				label: "Repeat",
				kicker: "RPT",
				swatch: "#888888",
				desc: "Repeat previous action",
				protocol: "",
			},
			settle: {
				label: "Settle",
				kicker: "STL",
				swatch: "#ef4444",
				desc: "Settle/repay position",
				protocol: "",
			},
		};
	}

	/* ──────────────────────────────────────────────
     Export to window scope
     ────────────────────────────────────────────── */

	transformers.transformMarkets = transformMarkets;
	transformers.transformPositions = transformPositions;
	transformers.transformActivities = transformActivities;
	transformers.formatTicker = formatTicker;
	transformers.transformStrategies = transformStrategies;
	transformers.transformProposals = transformProposals;
	transformers.transformCommunity = transformCommunity;
	transformers.transformNodeTypes = transformNodeTypes;
	transformers.transformVaultPositions = transformVaultPositions;
	transformers.calculateNetValue = calculateNetValue;
	transformers.calculateLTV = calculateLTV;

	if (typeof window !== "undefined") {
		window.__transformers = transformers;
	}
})();

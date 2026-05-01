module.exports = {
  extends: "solhint:recommended",
  rules: {
    "compiler-version": ["error", "0.8.25"],
    "func-visibility": ["error", { ignoreConstructors: true }],
    "max-line-length": ["warn", 120],
    "no-unused-vars": "error",
    "reason-string": ["warn", { maxLength: 64 }],
    // Conventional camelCase for immutables matches OpenZeppelin and the wider Solidity ecosystem;
    // SCREAMING_SNAKE_CASE would diverge from the rest of the project's naming.
    "immutable-vars-naming": "off",
    // The gas-* rules below are micro-optimizations that conflict with semantic clarity.
    // `<=` is semantically different from `<`; struct field order and event indexing are
    // chosen for readability and downstream filtering, not for byte-level packing.
    "gas-strict-inequalities": "off",
    "gas-struct-packing": "off",
    "gas-indexed-events": "off",
    "gas-increment-by-one": "off",
    // Block.timestamp is acceptable for deadlines tolerant to ~15s miner manipulation;
    // documented at point of use in NATSPEC.
    "not-rely-on-time": "off",
  },
};

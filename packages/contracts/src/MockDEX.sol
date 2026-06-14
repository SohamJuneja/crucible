// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @notice Minimal DEX for test fixtures on Mantle Sepolia.
 *         Fixed rate: amountOut = amountIn * RATE_NUMERATOR.
 *         Emits real ERC-20 Transfer events so the verification engine can decode them.
 *         Not audited. Not for production.
 */
contract MockDEX {
    uint256 public constant RATE_NUMERATOR = 2;  // 1 tokenIn → 2 tokenOut

    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut
    ) external returns (uint256 amountOut) {
        amountOut = amountIn * RATE_NUMERATOR;

        // Pull tokenIn from caller — emits Transfer(caller → this)
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Push tokenOut to caller — emits Transfer(this → caller)
        IERC20(tokenOut).transfer(msg.sender, amountOut);
    }
}

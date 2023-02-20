const { ethers, Wallet } = require("ethers");
const  { FlashbotsBundleProvider, FlashbotsBundleResolution }  = require("@flashbots/ethers-provider-bundle");
const { ChainId, Fetcher, WETH, Route, Trade, TokenAmount, TradeType } = require ('@uniswap/sdk');
const { getRawTransaction } = require("./getRawTransaction.js")

const FLASHBOTS_AUTH_KEY = "ADD KEY"

// ===== Uncomment this for mainnet =======
// const CHAIN_ID = 1
// const localProvider = "ws://localhost:8545"
// const provider = new ethers.providers.WebSocketProvider(localProvider)
// const FLASHBOTS_EP = undefined;
// ===== Uncomment this for mainnet =======

// ===== Uncomment this for Goerli =======
// const localProvider = "ws://localhost:8546"
// const provider = new ethers.providers.WebSocketProvider(localProvider)
// const FLASHBOTS_EP = 'https://relay-goerli.flashbots.net/'

// ===== Uncomment this for Goerli =======
const addresses = {
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', //UNISWAP??
    weth:'0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
    mainWallet: 'ADD WALLET',
    mainWalletPk: 'ADD PK',
    dai: '0x9D233A907E065855D2A9c7d4B552ea27fB2E5a36',
}
const pathDecoder = {
    '0x9D233A907E065855D2A9c7d4B552ea27fB2E5a36': 'DAI',
    '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6': 'WETH',
}
const wallet = new Wallet(addresses.mainWalletPk || '', provider)
const account = wallet.connect(provider);
const router = new ethers.Contract(
    addresses.router,
    [
      'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
      'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint[] memory amounts)', // wbnb
      'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint[] memory amounts)' //bnb
    ],
    account
  );

const authSigner = FLASHBOTS_AUTH_KEY ? new Wallet(FLASHBOTS_AUTH_KEY) : Wallet.createRandom()
const chainId = 5;

async function main() {
  console.log("//// Init search ////")
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_EP)
  provider.on("pending", (tx) => {
    provider.getTransaction(tx).then(async function (transaction) {
      if(transaction.to === addresses.router){
        console.log(transaction)
        evaluateTx(transaction, flashbotsProvider)        
      }
    })
  })
}


async function evaluateTx(transaction, flashbotsProvider){
    console.log("DETECTED TX")
    const iface = new ethers.utils.Interface(['function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint[] memory amounts)'])
    const decodedData = iface.decodeFunctionData('swapExactTokensForTokens', transaction.data)
    console.log(decodedData)
    console.log('From: '+ pathDecoder[decodedData.path[0]] + " to: " + pathDecoder[decodedData.path[1]])
    console.log('Buy: '+ ethers.utils.formatEther(decodedData.amountIn), 'For: '+ ethers.utils.formatEther(decodedData.amountOutMin))
    const actualPrice = await router.getAmountsOut(decodedData.amountIn, [decodedData.path[0], decodedData.path[1]]);
    console.log('Actual price ' + ethers.utils.formatEther(actualPrice[1]))
    const slipage = (1-ethers.utils.formatEther(decodedData.amountOutMin) / ethers.utils.formatEther(actualPrice[1]))
    console.log('Slipage: ' + slipage*100 + '%')
    const token = await Fetcher.fetchTokenData(chainId, decodedData.path[1], provider);
	  const weth = WETH[chainId];
	  const pair = await Fetcher.fetchPairData(token, weth, provider);
	  const route = new Route([pair], weth);
	  const trade = new Trade(route, new TokenAmount(weth, decodedData.amountIn), TradeType.EXACT_INPUT);
	  // console.log("Mid Price WETH --> DAI:", route.midPrice.toSignificant(6));
	  // console.log("Mid Price DAI --> WETH:", route.midPrice.invert().toSignificant(6));
	  // console.log("-".repeat(45));
	  // console.log("Execution Price WETH --> DAI:", trade.executionPrice.toSignificant(6));
	  // console.log("Mid Price after trade WETH --> DAI:", trade.nextMidPrice.toSignificant(6));
    const priceImpact = (1-trade.nextMidPrice.toSignificant(6)/trade.executionPrice.toSignificant(6))*100
    const ammountMax = ethers.utils.formatEther(decodedData.amountIn) * (((slipage*100)/priceImpact)-1)
    console.log("Price multiplier: " + (slipage*100/priceImpact), ammountMax)
    console.log("Price impact:", priceImpact + '%');
    //TODO: add a check for the price impact
    const blocknumber = await provider.getBlockNumber()
    makeMeSandwich(getRawTransaction(transaction, ethers), flashbotsProvider, blocknumber, '0.01')
}

async function makeMeSandwich(rawTransaction, flashbotsProvider, blocknumber, ammount){
  let feeData = await provider.getFeeData();
  let gasLimit = ethers.utils.hexlify(parseInt(300000))
  const amountsIn = await router.getAmountsOut(ethers.utils.parseUnits(ammount, 'ether'), [addresses.weth, addresses.dai]);
  console.log(amountsIn)
  console.log("out: " + amountsIn[1].toString())
  console.log("in: " + amountsIn[0].toString())
  const amountsOut = await router.getAmountsOut(amountsIn[1], [addresses.dai, addresses.weth]);
  const generatedTransactionBody = await router.populateTransaction.swapExactTokensForTokens(
    ethers.utils.parseUnits(ammount, 'ether'),
    amountsIn[1].sub(amountsIn[1].div(10)),
    [addresses.weth, addresses.dai],
    addresses.mainWallet,
    Date.now() + 1000 * 60 * 10, //10 minutes
  )
  const generatedTransactionBodySell = await router.populateTransaction.swapExactTokensForTokens(
    amountsIn[1],
    amountsOut[1].sub(amountsOut[1].div(10)),
    [addresses.dai, addresses.weth],
    addresses.mainWallet,
    Date.now() + 1000 * 60 * 10, //10 minutes
  )
  console.log("SELL: ", generatedTransactionBodySell)
  const actualNonce = await provider.getTransactionCount(wallet.address)
    const legacyTransaction = {
        ...generatedTransactionBody,
        gasPrice: feeData["gasPrice"],
        gasLimit: gasLimit,
        nonce: actualNonce
    }
    const legacyTransactionSell = {
        ...generatedTransactionBodySell,
        gasPrice: feeData["gasPrice"],
        gasLimit: gasLimit,
        nonce: actualNonce +1
    }
    console.log(legacyTransaction)
    console.log("SENDING THE TX")

    const signedTransactions = await flashbotsProvider.signBundle([
        {
            signer: wallet,
            transaction: legacyTransaction
        },
        {
            signedTransaction: rawTransaction // serialized signed transaction hex
        },
        {
            signer: wallet,
            transaction: legacyTransactionSell
        },
    //   {
    //     signer: wallet,
    //     transaction: eip1559Transaction
    //   }
    ])
    const targetBlock = blocknumber + 1
    for(var i = 0; i<5; i++){
        sendBundle(signedTransactions, targetBlock +i, flashbotsProvider)

    }
    
    // Code for simulation, don't use in production... we want to be fast
    // const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlock)
    // // Using TypeScript discrimination
    // if ('error' in simulation) {
    //   console.warn(`Simulation Error: ${simulation.error.message}`)
    //   process.exit(1)
    // } else {
    //   console.log(`Simulation Success: ${JSON.stringify(simulation, null, 2)}`)
    // }
    
}

async function sendBundle(signedTransactions, targetBlock, flashbotsProvider){
    const bundleSubmission = await flashbotsProvider.sendRawBundle(signedTransactions, targetBlock)
    console.log('bundle submitted, waiting')
    if ('error' in bundleSubmission) {
        throw new Error(bundleSubmission.error.message)
    }
    const waitResponse = await bundleSubmission.wait()
    console.log(`Wait Response: ${FlashbotsBundleResolution[waitResponse]}`)
    if (waitResponse === FlashbotsBundleResolution.BundleIncluded || waitResponse === FlashbotsBundleResolution.AccountNonceTooHigh) {
        console.log("DONE")
        //process.exit(0)
    } else {
        console.log({
        // bundleStats: await flashbotsProvider.getBundleStats(simulation.bundleHash, targetBlock),
        // userStats: await flashbotsProvider.getUserStats()
        waitResponse
        })
    }
}



main()
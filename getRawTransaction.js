function getRawTransaction(tx, ethers) {
    function addKey(accum, key) {
      if (tx[key] !== null || tx[key] !== undefined) { accum[key] = tx[key]; }
      return accum;
    }
  
    // Extract the relevant parts of the transaction and signature
    let txFields = "hash accessList chainId data gasPrice gasLimit maxFeePerGas maxPriorityFeePerGas nonce to type from value".split(" ");
    if(tx.maxFeePerGas || tx.maxPriorityFeePerGas){
      txFields = "hash accessList chainId data gasPrice gasLimit maxFeePerGas maxPriorityFeePerGas nonce to type from value".split(" ");
    }else{
      txFields = "type gasPrice gasLimit to value nonce data chainId".split(" "); 
  
    }
    const sigFields = "v r s".split(" ");
  
    // Seriailze the signed transaction
    const raw = ethers.utils.serializeTransaction(
      txFields.reduce(addKey, { }), 
      sigFields.reduce(addKey, { }));
  
    // Double check things went well
    if (ethers.utils.keccak256(raw) !== tx.hash) { throw new Error("serializing failed!"); }
  
    return raw;
  }

module.exports = Object.freeze({
    getRawTransaction: getRawTransaction
});
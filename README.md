# Pump.fun Multi-Wallet Interaction Tool

A powerful tool for interacting with pump.fun using multiple wallets and automated captcha solving.

## Required Files

1. `wallets.txt` - One private key per line
2. `proxies.txt` (optional) - One proxy per line (supports http:// and socks:// formats)
3. `comments.txt` (optional) - One comment per line for random selection
4. `captcha_config.json` (auto-generated) - Captcha service configuration

## Setup

1. Install Node.js (v16 or higher)
2. Clone this repository
3. Install dependencies:
```bash
npm install
```

4. Create required files:
- Create `wallets.txt` with your wallet private keys
- (Optional) Create `proxies.txt` with your proxies
- (Optional) Create `comments.txt` with your comments

5. Run the program:
```bash
npm start
```

## Features

- Multi-wallet support with automatic rotation
- Proxy support (HTTP and SOCKS)
- Multiple captcha service integration (2captcha, Anti-Captcha, CapMonster)
- Customizable delays between actions
- Balance checking
- Random comment selection
- Detailed logging and error handling

## Configuration

### Wallet Format
```
[private_key_1]
[private_key_2]
...
```

### Proxy Format
```
http://username:password@host:port
socks://username:password@host:port
```

### Comments Format
```
Great project! 🚀
Amazing work! 💪
...
```

## Usage

1. Start the program
2. Configure captcha services (if needed)
3. Set desired delay between actions
4. Start comment loop with target thread ID
5. Monitor the automated process

## Error Handling

The program includes comprehensive error handling for:
- Network issues
- Invalid wallet keys
- Insufficient balances
- Captcha failures
- Proxy connection issues

## Support

For issues or questions, please open an issue in the repository.

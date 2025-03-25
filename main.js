import fs from 'fs';
import readline from 'readline';
import axios from 'axios';
import chalk from 'chalk';
import httpsProxyAgent from 'https-proxy-agent';
import socksProxyAgent from 'socks-proxy-agent';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import bs58 from 'bs58';
import puppeteer from 'puppeteer';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const SOLANA_CONNECTION = new Connection('https://api.mainnet-beta.solana.com');
const PUMP_WEBSITE = 'https://pump.fun';

let currentWalletIndex = 0;
let wallets = [];
let proxies = [];
let currentProxyIndex = 0;
let isRunning = true;
let delayBetweenActions = 1000; // Default 1 second
let browser = null;
let page = null;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function promptUser(query) {
	return new Promise((resolve) => rl.question(query, resolve));
}

const CAPTCHA_SERVICES = {
	'2CAPTCHA': {
		name: '2Captcha',
		url: 'https://2captcha.com/in.php',
		resultUrl: 'https://2captcha.com/res.php',
		defaultTimeout: 120000,
		minBalance: 0.003
	},
	'ANTI_CAPTCHA': {
		name: 'Anti-Captcha',
		url: 'https://api.anti-captcha.com/createTask',
		resultUrl: 'https://api.anti-captcha.com/getTaskResult',
		defaultTimeout: 120000,
		minBalance: 0.003
	},
	'CAPMONSTER': {
		name: 'CapMonster',
		url: 'https://api.capmonster.cloud/createTask',
		resultUrl: 'https://api.capmonster.cloud/getTaskResult',
		defaultTimeout: 120000,
		minBalance: 0.003
	}
};

let captchaConfig = {
	'2CAPTCHA': { enabled: false, apiKey: '' },
	'ANTI_CAPTCHA': { enabled: false, apiKey: '' },
	'CAPMONSTER': { enabled: false, apiKey: '' }
};

// Create config directory if it doesn't exist
try {
	if (!fs.existsSync('./config')) {
		fs.mkdirSync('./config');
	}
} catch (error) {
	console.log(chalk.yellowBright("Note: Unable to create config directory:", error.message));
}

// Load captcha configuration
try {
	if (fs.existsSync('./config/captcha_config.json')) {
		const savedConfig = JSON.parse(fs.readFileSync('./config/captcha_config.json', 'utf8'));
		captchaConfig = { ...captchaConfig, ...savedConfig };
		if (Object.entries(captchaConfig).some(([_, config]) => config.enabled)) {
			console.log(chalk.greenBright("Captcha configuration loaded successfully"));
		}
	} else {
		console.log(chalk.yellowBright("Note: No captcha configuration found"));
		console.log(chalk.gray("Captcha services can be configured in the settings menu"));
	}
} catch (error) {
	console.log(chalk.yellowBright("Note: Error loading captcha configuration:", error.message));
	console.log(chalk.gray("Default configuration will be used"));
}

async function saveCaptchaConfig() {
	try {
		if (!fs.existsSync('./config')) {
			fs.mkdirSync('./config');
		}
		fs.writeFileSync('./config/captcha_config.json', JSON.stringify(captchaConfig, null, 2));
		console.log(chalk.greenBright('Captcha configuration saved successfully'));
	} catch (error) {
		console.log(chalk.redBright('Error saving captcha configuration:', error.message));
		console.log(chalk.gray('Changes will not persist after program restart'));
	}
}

async function configureCaptchaServices() {
	console.log(chalk.blueBright('\nCaptcha Service Configuration'));
	console.log(chalk.whiteBright('Configure which services you want to use for solving captchas.'));
	
	for (const [serviceKey, service] of Object.entries(CAPTCHA_SERVICES)) {
		const useService = await promptUser(chalk.yellowBright(`\nDo you want to use ${service.name}? (y/n): `));
		
		if (useService.toLowerCase() === 'y') {
			const apiKey = await promptUser(chalk.yellowBright(`Enter your ${service.name} API key: `));
			captchaConfig[serviceKey].enabled = true;
			captchaConfig[serviceKey].apiKey = apiKey;
			
			// Test the API key
			const balance = await checkCaptchaBalance(serviceKey);
			if (balance !== null) {
				console.log(chalk.greenBright(`${service.name} configured successfully! Balance: $${balance}`));
			} else {
				console.log(chalk.redBright(`Failed to validate ${service.name} API key`));
				captchaConfig[serviceKey].enabled = false;
				captchaConfig[serviceKey].apiKey = '';
			}
		} else {
			captchaConfig[serviceKey].enabled = false;
			captchaConfig[serviceKey].apiKey = '';
		}
	}
	
	await saveCaptchaConfig();
}

async function checkCaptchaBalance(serviceKey) {
	const service = CAPTCHA_SERVICES[serviceKey];
	const config = captchaConfig[serviceKey];
	
	if (!config.enabled || !config.apiKey) return null;
	
	try {
		let response;
		switch (serviceKey) {
			case '2CAPTCHA':
				response = await axios.get(`https://2captcha.com/res.php?key=${config.apiKey}&action=getBalance`);
				return parseFloat(response.data.split('|')[1]);
				
			case 'ANTI_CAPTCHA':
				response = await axios.post('https://api.anti-captcha.com/getBalance', {
					clientKey: config.apiKey
				});
				return response.data.balance;
				
			case 'CAPMONSTER':
				response = await axios.post('https://api.capmonster.cloud/getBalance', {
					clientKey: config.apiKey
				});
				return response.data.balance;
		}
	} catch (error) {
		console.log(chalk.redBright(`Error checking ${service.name} balance:`, error.message));
		return null;
	}
}

async function solveCaptcha(siteKey, url) {
	// Try each enabled service in order until one succeeds
	for (const [serviceKey, config] of Object.entries(captchaConfig)) {
		if (!config.enabled) continue;
		
		const service = CAPTCHA_SERVICES[serviceKey];
		console.log(chalk.blueBright(`Attempting to solve captcha using ${service.name}...`));
		
		try {
			let taskId;
			switch (serviceKey) {
				case '2CAPTCHA':
					const response = await axios.post(service.url, {
						key: config.apiKey,
						method: 'userrecaptcha',
						googlekey: siteKey,
						pageurl: url,
						json: 1
					});
					taskId = response.data.request;
					break;
					
				case 'ANTI_CAPTCHA':
				case 'CAPMONSTER':
					const resp = await axios.post(service.url, {
						clientKey: config.apiKey,
						task: {
							type: 'RecaptchaV2TaskProxyless',
							websiteURL: url,
							websiteKey: siteKey
						}
					});
					taskId = resp.data.taskId;
					break;
			}
			
			// Wait for result
			const startTime = Date.now();
			while (Date.now() - startTime < service.defaultTimeout) {
				await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
				
				const result = await checkCaptchaResult(serviceKey, taskId);
				if (result) {
					console.log(chalk.greenBright(`Captcha solved successfully using ${service.name}`));
					return result;
				}
			}
			
			console.log(chalk.yellowBright(`${service.name} timeout, trying next service...`));
		} catch (error) {
			console.log(chalk.redBright(`Error with ${service.name}:`, error.message));
		}
	}
	
	throw new Error('All captcha services failed');
}

async function checkCaptchaResult(serviceKey, taskId) {
	const service = CAPTCHA_SERVICES[serviceKey];
	const config = captchaConfig[serviceKey];
	
	try {
		let response;
		switch (serviceKey) {
			case '2CAPTCHA':
				response = await axios.get(`${service.resultUrl}?key=${config.apiKey}&action=get&id=${taskId}&json=1`);
				if (response.data.status === 1) {
					return response.data.request;
				}
				break;
				
			case 'ANTI_CAPTCHA':
			case 'CAPMONSTER':
				response = await axios.post(service.resultUrl, {
					clientKey: config.apiKey,
					taskId: taskId
				});
				if (response.data.status === 'ready') {
					return response.data.solution.gRecaptchaResponse;
				}
				break;
		}
	} catch (error) {
		console.log(chalk.redBright(`Error checking ${service.name} result:`, error.message));
	}
	return null;
}

async function handleCaptcha() {
	try {
		// Wait for captcha iframe to be available
		const captchaFrame = await page.waitForSelector('iframe[title="reCAPTCHA"]', { timeout: 5000 });
		if (!captchaFrame) {
			console.log(chalk.yellowBright('No captcha detected, continuing...'));
			return true;
		}

		console.log(chalk.blueBright('Captcha detected, attempting to solve...'));
		
		// Get the sitekey
		const sitekey = await page.evaluate(() => {
			const iframe = document.querySelector('iframe[title="reCAPTCHA"]');
			return iframe.getAttribute('data-sitekey');
		});
		
		if (!sitekey) {
			console.log(chalk.redBright('Could not find reCAPTCHA sitekey'));
			return false;
		}
		
		// Get the current URL
		const url = await page.url();
		
		// Solve the captcha using configured services
		const solution = await solveCaptcha(sitekey, url);
		
		// Input the solution
		await page.evaluate((token) => {
			window.grecaptcha.getResponse = () => token;
			window.grecaptcha.execute();
		}, solution);
		
		console.log(chalk.greenBright('Captcha solved successfully'));
		return true;
	} catch (error) {
		console.log(chalk.redBright('Error handling captcha:', error.message));
		return false;
	}
}

async function initializeBrowser() {
	try {
		const proxy = getNextProxy();
		const options = {
			headless: false,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-accelerated-2d-canvas',
				'--disable-gpu'
			]
		};

		if (proxy) {
			if (proxy.startsWith('http')) {
				options.args.push(`--proxy-server=${proxy}`);
			} else if (proxy.startsWith('socks')) {
				options.args.push(`--proxy-server=${proxy.replace('socks://', '')}`);
			}
		}

		browser = await puppeteer.launch(options);
		page = await browser.newPage();
		
		// Set viewport and user agent
		await page.setViewport({ width: 1280, height: 800 });
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
		
		console.log(chalk.greenBright('Browser initialized successfully'));
		return true;
	} catch (error) {
		console.log(chalk.redBright('Error initializing browser:', error.message));
		return false;
	}
}

async function closeBrowser() {
	if (browser) {
		await browser.close();
		browser = null;
		page = null;
	}
}

// Add validation functions
function validateWallet(wallet) {
	try {
		return wallet && wallet.publicKey && wallet.secretKey;
	} catch (error) {
		return false;
	}
}

function validateProxy(proxy) {
	try {
		const proxyUrl = new URL(proxy);
		return proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:' || proxyUrl.protocol === 'socks:';
	} catch (error) {
		return false;
	}
}

// Enhance loadWallets function
function loadWallets() {
	try {
		if (!fs.existsSync("./wallets.txt")) {
			console.log(chalk.yellowBright("\nNote: wallets.txt not found"));
			console.log(chalk.gray("Some features requiring wallets will be limited until wallets are added."));
			return [];
		}

		const walletsFile = fs.readFileSync("./wallets.txt", "utf8");
		const loadedWallets = walletsFile.split("\n")
			.filter(line => line.trim() && !line.startsWith('#'))
			.map((privateKey, index) => {
				try {
					const secretKey = bs58.decode(privateKey.trim());
					const wallet = Keypair.fromSecretKey(secretKey);
					if (!validateWallet(wallet)) {
						throw new Error("Invalid wallet format");
					}
					return wallet;
				} catch (error) {
					console.log(chalk.yellowBright(`Note: Skipping invalid wallet at line ${index + 1}: ${error.message}`));
					return null;
				}
			})
			.filter(wallet => wallet !== null);
		
		if (loadedWallets.length > 0) {
			console.log(chalk.greenBright(`Successfully loaded ${loadedWallets.length} wallets`));
		}
		return loadedWallets;
	} catch (error) {
		console.log(chalk.yellowBright("Note: Error loading wallets:", error.message));
		return [];
	}
}

// Enhance loadProxies function
function loadProxies() {
	try {
		if (!fs.existsSync("./proxies.txt")) {
			console.log(chalk.yellowBright("Note: proxies.txt not found"));
			console.log(chalk.gray("Running without proxies. Some features may have limited functionality."));
			return [];
		}

	const proxiesFile = fs.readFileSync("./proxies.txt", "utf8");
		const loadedProxies = proxiesFile.split("\n")
			.filter(line => line.trim() && !line.startsWith('#'))
			.map((proxy, index) => {
				if (!validateProxy(proxy.trim())) {
					console.log(chalk.yellowBright(`Note: Skipping invalid proxy at line ${index + 1}`));
					return null;
				}
				return proxy.trim();
			})
			.filter(proxy => proxy !== null);
		
		if (loadedProxies.length > 0) {
			console.log(chalk.greenBright(`Successfully loaded ${loadedProxies.length} proxies`));
		}
		return loadedProxies;
	} catch (error) {
		console.log(chalk.yellowBright("Note: Error loading proxies:", error.message));
		return [];
	}
}

function getNextWallet() {
	if (wallets.length === 0) {
		wallets = loadWallets();
		if (wallets.length === 0) {
			throw new Error("No wallets available. Please add wallets to wallets.txt");
		}
	}
	const wallet = wallets[currentWalletIndex];
	currentWalletIndex = (currentWalletIndex + 1) % wallets.length;
	return wallet;
}

function getNextProxy() {
	if (proxies.length === 0) return null;
	const proxy = proxies[currentProxyIndex];
	currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
	return proxy;
}

async function checkWalletBalance(wallet) {
	try {
		const balance = await SOLANA_CONNECTION.getBalance(wallet.publicKey);
		return balance / LAMPORTS_PER_SOL;
	} catch (error) {
		console.log(chalk.redBright(`Error checking balance for wallet ${wallet.publicKey.toString()}: ${error.message}`));
		return 0;
	}
}

// Enhance commentThread function
async function commentThread(threadId, wallet) {
	try {
		// Validate wallet
		if (!validateWallet(wallet)) {
			console.log(chalk.redBright("Invalid wallet provided"));
			return false;
		}

		// Check balance
		const balance = await checkWalletBalance(wallet);
		if (balance < 0.002) {
			console.log(chalk.redBright(`Insufficient balance in wallet ${wallet.publicKey.toString()}: ${balance} SOL`));
			return false;
		}

		// Validate thread ID
		if (!threadId || threadId.trim() === "") {
			console.log(chalk.redBright("Invalid thread ID"));
			return false;
		}

		// Navigate to thread page
		try {
			await page.goto(`${PUMP_WEBSITE}/thread/${threadId}`, { 
				waitUntil: 'networkidle0',
				timeout: 30000 
			});
		} catch (error) {
			console.log(chalk.redBright("Error loading thread page:", error.message));
			return false;
		}

		// Handle captcha
		const captchaSolved = await handleCaptcha();
		if (!captchaSolved) {
			console.log(chalk.redBright("Failed to solve captcha"));
			return false;
		}

		// Get comment text
		const commentText = await randomComment();
		if (!commentText) {
			console.log(chalk.redBright("Failed to get comment text"));
			return false;
		}

		// Create and send transaction
		try {
			const commentIx = SystemProgram.transfer({
				fromPubkey: wallet.publicKey,
				toPubkey: PUMP_PROGRAM_ID,
				lamports: 0.001 * LAMPORTS_PER_SOL
			});

			const commentTx = new Transaction().add(commentIx);
			commentTx.feePayer = wallet.publicKey;
			commentTx.recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

			const signature = await SOLANA_CONNECTION.sendTransaction(commentTx, [wallet]);
			await SOLANA_CONNECTION.confirmTransaction(signature);
			
			console.log(chalk.greenBright(`Comment posted from ${wallet.publicKey.toString()}`));
			console.log(chalk.greenBright(`Text: ${commentText}`));
			console.log(chalk.greenBright(`Transaction: ${signature}`));
			return true;
		} catch (error) {
			console.log(chalk.redBright("Transaction error:", error.message));
			return false;
		}
	} catch (error) {
		console.log(chalk.redBright(`Error in comment thread: ${error.message}`));
		return false;
	}
}

// Enhance startCommentLoop function
async function startCommentLoop(threadId) {
	if (!threadId || threadId.trim() === "") {
		console.log(chalk.redBright("\nInvalid thread ID"));
		return;
	}

	if (wallets.length === 0) {
		console.log(chalk.redBright("\nNo wallets available. Please add wallets to wallets.txt"));
		return;
	}

	console.log(chalk.greenBright("\nStarting comment loop..."));
	console.log(chalk.blueBright(`Using ${wallets.length} wallets and ${proxies.length} proxies`));
	console.log(chalk.blueBright(`Delay between actions: ${delayBetweenActions}ms`));

	// Initialize browser
	if (!browser) {
		const initialized = await initializeBrowser();
		if (!initialized) {
			console.log(chalk.redBright("Failed to initialize browser. Please try again."));
			return;
		}
	}

	let consecutiveFailures = 0;
	const MAX_CONSECUTIVE_FAILURES = 3;

	while (isRunning) {
		try {
			const wallet = getNextWallet();
			console.log(chalk.yellowBright(`\nUsing wallet: ${wallet.publicKey.toString()}`));
			
			const success = await commentThread(threadId, wallet);
			
			if (success) {
				consecutiveFailures = 0;
				console.log(chalk.yellowBright(`Waiting ${delayBetweenActions}ms before next action...`));
				await new Promise(resolve => setTimeout(resolve, delayBetweenActions));
			} else {
				consecutiveFailures++;
				if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
					console.log(chalk.redBright(`\nStopping loop due to ${MAX_CONSECUTIVE_FAILURES} consecutive failures`));
					isRunning = false;
					break;
				}
				console.log(chalk.yellowBright("Skipping delay due to failed comment"));
			}
		} catch (error) {
			console.log(chalk.redBright("Error in comment loop:", error.message));
			consecutiveFailures++;
			if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				console.log(chalk.redBright(`\nStopping loop due to ${MAX_CONSECUTIVE_FAILURES} consecutive failures`));
				isRunning = false;
				break;
			}
			await new Promise(resolve => setTimeout(resolve, delayBetweenActions));
		}
	}

	await closeBrowser();
}

async function randomComment() {
	try {
	const commentsFile = fs.readFileSync("./comments.txt", "utf8");
		const comments = commentsFile.split("\n").filter(Boolean);
	return comments[Math.floor(Math.random() * comments.length)];
	} catch (error) {
		return "Great project! 🚀";
	}
}

// Add function to create template files
async function createTemplateFile(filename, template) {
	try {
		if (!fs.existsSync(filename)) {
			fs.writeFileSync(filename, template);
			console.log(chalk.greenBright(`Created template ${filename}`));
		}
	} catch (error) {
		console.log(chalk.redBright(`Error creating ${filename}:`, error.message));
	}
}

// Add function to setup required files
async function setupRequiredFiles() {
	const walletsTemplate = `# Add your wallet private keys here, one per line
# Example format:
# 4KvGWaGBH7RZKUKVJmEgxvUqtYByHGJ8yDUPXGBZe4YhAoRJXJCQH9MzqtXHwFqQzy7rNwGUYvYd9ATpVx4zGUMJ
# Remove this comment and add your actual private keys`;

	const proxiesTemplate = `# Add your proxies here, one per line
# Supported formats:
# http://username:password@host:port
# socks://username:password@host:port
# Remove this comment and add your actual proxies`;

	const commentsTemplate = `Great project! 🚀
Amazing work! 💪
Looking forward to the future! 🌟
Incredible potential! 🔥
Solid team and roadmap! 👏`;

	await createTemplateFile("wallets.txt", walletsTemplate);
	await createTemplateFile("proxies.txt", proxiesTemplate);
	await createTemplateFile("comments.txt", commentsTemplate);
}

// Modify displayMainMenu to show feature availability
async function displayMainMenu() {
	console.clear();
	console.log(chalk.blueBright("\n=== Pump.fun Multi-Wallet Interaction Tool ===\n"));
	
	// Display current status with warnings
	console.log(chalk.whiteBright("Current Status:"));
	console.log(chalk.gray("├─ Wallets: ") + (wallets.length > 0 ? 
		chalk.green(`${wallets.length} loaded`) : 
		chalk.yellow("None loaded") + chalk.gray(" (required for commenting)")));
	console.log(chalk.gray("├─ Proxies: ") + (proxies.length > 0 ? 
		chalk.green(`${proxies.length} loaded`) : 
		chalk.yellow("None loaded") + chalk.gray(" (recommended for safety)")));
	console.log(chalk.gray("├─ Delay: ") + chalk.cyan(`${delayBetweenActions}ms`));
	console.log(chalk.gray("└─ Captcha: ") + (Object.entries(captchaConfig).some(([_, config]) => config.enabled) ? 
		chalk.green("Configured") : 
		chalk.yellow("Not configured") + chalk.gray(" (required for commenting)")));

	console.log(chalk.whiteBright("\nAvailable Options:"));
	console.log(chalk.gray("├─ [") + chalk.green("1") + chalk.gray("] Browse Pump.fun"));
	console.log(chalk.gray("├─ [") + chalk.green("2") + chalk.gray("] Start Comment Loop ") + 
		(wallets.length === 0 ? chalk.yellow("(Requires wallets)") : ""));
	console.log(chalk.gray("├─ [") + chalk.green("3") + chalk.gray("] Wallet Management"));
	console.log(chalk.gray("├─ [") + chalk.green("4") + chalk.gray("] Proxy Management"));
	console.log(chalk.gray("├─ [") + chalk.green("5") + chalk.gray("] Configure Captcha Services"));
	console.log(chalk.gray("├─ [") + chalk.green("6") + chalk.gray("] Settings"));
	console.log(chalk.gray("├─ [") + chalk.green("7") + chalk.gray("] Setup Required Files"));
	console.log(chalk.gray("└─ [") + chalk.green("8") + chalk.gray("] Exit\n"));

	return await promptUser(chalk.blueBright("Enter your choice (1-8): "));
}

async function displayWalletManagement() {
	console.clear();
	console.log(chalk.blueBright("\n=== Wallet Management ===\n"));
	
	// Display current wallets
	console.log(chalk.whiteBright("Current Wallets:"));
	for (const [index, wallet] of wallets.entries()) {
		const balance = await checkWalletBalance(wallet);
		console.log(chalk.gray(`${index + 1}. `) + chalk.cyan(`${wallet.publicKey.toString()}`) + chalk.gray(` (${balance} SOL)`));
	}

	console.log(chalk.whiteBright("\nOptions:"));
	console.log(chalk.gray("├─ [") + chalk.green("1") + chalk.gray("] Check All Balances"));
	console.log(chalk.gray("├─ [") + chalk.green("2") + chalk.gray("] Reload Wallets"));
	console.log(chalk.gray("└─ [") + chalk.green("3") + chalk.gray("] Back to Main Menu\n"));

	const choice = await promptUser(chalk.blueBright("Enter your choice (1-3): "));
	
	switch (choice) {
		case "1":
			console.log(chalk.yellowBright("\nChecking wallet balances..."));
			for (const wallet of wallets) {
				const balance = await checkWalletBalance(wallet);
				console.log(chalk.whiteBright(`${wallet.publicKey.toString()}: ${balance} SOL`));
			}
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayWalletManagement();
			
		case "2":
			wallets = loadWallets();
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayWalletManagement();
			
		case "3":
			return await displayMainMenu();
			
		default:
			console.log(chalk.redBright("\nInvalid choice, please try again."));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayWalletManagement();
	}
}

async function displayProxyManagement() {
	console.clear();
	console.log(chalk.blueBright("\n=== Proxy Management ===\n"));
	
	// Display current proxies
	console.log(chalk.whiteBright("Current Proxies:"));
	for (const [index, proxy] of proxies.entries()) {
		console.log(chalk.gray(`${index + 1}. `) + chalk.cyan(proxy));
	}

	console.log(chalk.whiteBright("\nOptions:"));
	console.log(chalk.gray("├─ [") + chalk.green("1") + chalk.gray("] Test All Proxies"));
	console.log(chalk.gray("├─ [") + chalk.green("2") + chalk.gray("] Reload Proxies"));
	console.log(chalk.gray("└─ [") + chalk.green("3") + chalk.gray("] Back to Main Menu\n"));

	const choice = await promptUser(chalk.blueBright("Enter your choice (1-3): "));
	
	switch (choice) {
		case "1":
			console.log(chalk.yellowBright("\nTesting proxies..."));
			for (const proxy of proxies) {
				try {
					const proxyAgent = proxy.startsWith('http') ? 
						new httpsProxyAgent(proxy) : 
						new socksProxyAgent(proxy);
					
					await axios.get('https://api.ipify.org?format=json', { 
						httpsAgent: proxyAgent,
						timeout: 5000
					});
					console.log(chalk.greenBright(`✓ ${proxy} - Working`));
				} catch (error) {
					console.log(chalk.redBright(`✗ ${proxy} - Failed`));
				}
			}
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayProxyManagement();
			
		case "2":
			proxies = loadProxies();
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayProxyManagement();
			
		case "3":
			return await displayMainMenu();
			
		default:
			console.log(chalk.redBright("\nInvalid choice, please try again."));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displayProxyManagement();
	}
}

async function displaySettings() {
	console.clear();
	console.log(chalk.blueBright("\n=== Settings ===\n"));
	
	console.log(chalk.whiteBright("Current Settings:"));
	console.log(chalk.gray("├─ Delay: ") + chalk.cyan(`${delayBetweenActions}ms`));
	console.log(chalk.gray("└─ Browser: ") + chalk.cyan(`${browser ? 'Active' : 'Inactive'}\n`));

	console.log(chalk.whiteBright("Options:"));
	console.log(chalk.gray("├─ [") + chalk.green("1") + chalk.gray("] Set Delay"));
	console.log(chalk.gray("├─ [") + chalk.green("2") + chalk.gray("] Reset Browser"));
	console.log(chalk.gray("└─ [") + chalk.green("3") + chalk.gray("] Back to Main Menu\n"));

	const choice = await promptUser(chalk.blueBright("Enter your choice (1-3): "));
	
	switch (choice) {
		case "1":
			const delay = await promptUser(chalk.blueBright("\nEnter delay in milliseconds (e.g., 1000 for 1 second): "));
			delayBetweenActions = parseInt(delay);
			console.log(chalk.greenBright(`Delay set to ${delayBetweenActions}ms`));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displaySettings();
			
		case "2":
			await closeBrowser();
			console.log(chalk.greenBright("\nBrowser reset successfully"));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displaySettings();
			
		case "3":
			return await displayMainMenu();
			
		default:
			console.log(chalk.redBright("\nInvalid choice, please try again."));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return await displaySettings();
	}
}

// Add browsing functionality
async function browsePumpFun() {
	console.log(chalk.blueBright("\nInitializing browser for Pump.fun..."));
	
	if (!browser) {
		const initialized = await initializeBrowser();
		if (!initialized) {
			console.log(chalk.redBright("Failed to initialize browser"));
			await promptUser(chalk.gray("\nPress Enter to continue..."));
			return;
		}
	}

	try {
		await page.goto(PUMP_WEBSITE, { waitUntil: 'networkidle0' });
		console.log(chalk.greenBright("\nBrowser opened to Pump.fun"));
		console.log(chalk.gray("Browser will remain open until you choose to close it in the settings"));
		await promptUser(chalk.gray("\nPress Enter to return to menu..."));
	} catch (error) {
		console.log(chalk.redBright("\nError accessing Pump.fun:", error.message));
		await promptUser(chalk.gray("\nPress Enter to continue..."));
	}
}

// Modify main function to handle missing requirements
async function main() {
	console.log(chalk.greenBright("\n=== Initializing Pump.fun Multi-Wallet Interaction Tool ==="));
	
	// Load initial resources
	wallets = loadWallets();
	proxies = loadProxies();

	while (true) {
		const choice = await displayMainMenu();
		
		switch (choice) {
		case "1":
				await browsePumpFun();
			break;
				
		case "2":
				if (wallets.length === 0) {
					console.log(chalk.yellow("\nWarning: No wallets available"));
					console.log(chalk.gray("Use option 3 (Wallet Management) to add wallets"));
					await promptUser(chalk.gray("\nPress Enter to continue..."));
					break;
				}
				if (!Object.entries(captchaConfig).some(([_, config]) => config.enabled)) {
					console.log(chalk.yellow("\nWarning: No captcha service configured"));
					console.log(chalk.gray("Use option 5 to configure captcha services"));
					const proceed = await promptUser(chalk.yellowBright("Do you want to proceed anyway? (y/n): "));
					if (proceed.toLowerCase() !== 'y') break;
				}
				const threadId = await promptUser(chalk.blueBright("\nEnter thread ID: "));
				isRunning = true;
				await startCommentLoop(threadId);
			break;
				
		case "3":
				await displayWalletManagement();
			break;
				
		case "4":
				await displayProxyManagement();
			break;
				
		case "5":
				await configureCaptchaServices();
				await promptUser(chalk.gray("\nPress Enter to continue..."));
			break;
				
		case "6":
				await displaySettings();
				break;
				
			case "7":
				await setupRequiredFiles();
				console.log(chalk.gray("\nTemplate files have been created. Please edit them with your actual data."));
				await promptUser(chalk.gray("\nPress Enter to continue..."));
				break;
				
			case "8":
				console.log(chalk.greenBright("\nExiting..."));
				await closeBrowser();
				isRunning = false;
			rl.close();
			process.exit(0);
				
		default:
				console.log(chalk.redBright("\nInvalid choice, please try again"));
				await promptUser(chalk.gray("\nPress Enter to continue..."));
		}
	}
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
	console.log(chalk.yellowBright("\nStopping comment loop..."));
	isRunning = false;
	await closeBrowser();
	process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
	console.log(chalk.redBright('\nUncaught exception:', error.message));
	await closeBrowser();
	process.exit(1);
});

main();

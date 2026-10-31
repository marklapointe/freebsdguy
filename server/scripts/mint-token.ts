import { mintToken } from '../lib/api-tokens.ts';
import { parseMintTokenArgs } from '../lib/mint-token-cli.ts';

const main = () => {
    const args = parseMintTokenArgs(process.argv);
    const { plaintext, record } = mintToken(args.username, args.label, args.scope);
    process.stdout.write(`${plaintext}\n`);
    console.error(`id=${record.id} scope=${record.scope} prefix=${record.prefix}`);
};

try {
    main();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}

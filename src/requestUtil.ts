import type { Request } from './AbstractMessage.js';
import { BareError } from './BareServer.js';
import type { ServerConfig } from './BareServer.js';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';

const httpAgent = new HttpAgent();
const httpsAgent = new HttpsAgent();

export interface BareRemote {
	host: string;
	port: number | string;
	path: string;
	protocol: string;
}

export type BareHeaders = Record<string, string | string[]>;

function outgoingError<T>(error: T): T | BareError {
	if (error instanceof Error) {
		switch ((<Error & { code?: string }>error).code) {
			case 'ENOTFOUND':
				return new BareError(500, {
					code: 'HOST_NOT_FOUND',
					id: 'request',
					message: 'The specified host could not be resolved.',
				});
			case 'ECONNREFUSED':
				return new BareError(500, {
					code: 'CONNECTION_REFUSED',
					id: 'response',
					message: 'The remote rejected the request.',
				});
			case 'ECONNRESET':
				return new BareError(500, {
					code: 'CONNECTION_RESET',
					id: 'response',
					message: 'The request was forcibly closed.',
				});
			case 'ETIMEOUT':
				return new BareError(500, {
					code: 'CONNECTION_TIMEOUT',
					id: 'response',
					message: 'The response timed out.',
				});
		}
	}

	return error;
}

export async function fetch(
	config: ServerConfig,
	request: Request,
	requestHeaders: BareHeaders,
	url: BareRemote
): Promise<IncomingMessage> {
	const options = {
		host: url.host,
		port: url.port,
		path: url.path,
		method: request.method,
		headers: requestHeaders,
		setHost: false,
		localAddress: config.localAddress,
	};

	let outgoing: ClientRequest;

	if (url.protocol === 'https:') {
		outgoing = httpsRequest({ ...options, agent: httpsAgent });
	} else if (url.protocol === 'http:') {
		outgoing = httpRequest({ ...options, agent: httpAgent });
	} else {
		throw new RangeError(`Unsupported protocol: '${url.protocol}'`);
	}

	request.body.pipe(outgoing);

	return await new Promise((resolve, reject) => {
		outgoing.on('response', (response: IncomingMessage) => {
			resolve(response);
		});

		outgoing.on('error', (error: Error) => {
			reject(outgoingError(error));
		});
	});
}

export async function upgradeFetch(
	serverConfig: ServerConfig,
	request: Request,
	requestHeaders: BareHeaders,
	remote: BareRemote
): Promise<[IncomingMessage, Duplex, Buffer]> {
	const options = {
		host: remote.host,
		port: remote.port,
		path: remote.path,
		headers: requestHeaders,
		method: request.method,
		setHost: false,
		localAddress: serverConfig.localAddress,
	};

	let outgoing: ClientRequest;

	if (remote.protocol === 'wss:') {
		outgoing = httpsRequest({ ...options, agent: httpsAgent });
	} else if (remote.protocol === 'ws:') {
		outgoing = httpRequest({ ...options, agent: httpAgent });
	} else {
		throw new RangeError(`Unsupported protocol: '${remote.protocol}'`);
	}

	outgoing.end();

	return await new Promise((resolve, reject) => {
		outgoing.on('response', () => {
			reject('Remote did not upgrade the WebSocket');
		});

		outgoing.on(
			'upgrade',
			(request: IncomingMessage, socket: Duplex, head: Buffer) => {
				resolve([request, socket, head]);
			}
		);

		outgoing.on('error', (error) => {
			reject(outgoingError(error));
		});
	});
}

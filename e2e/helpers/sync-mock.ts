import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Logger } from '../../src/core/logger';

const MANIFEST_FILE_PREFIX = 'kechimochi-manifest-';
const SNAPSHOT_FILE_PREFIX = 'kechimochi-snapshot-';
const MANIFEST_FILE_SUFFIX = '.json';
const SNAPSHOT_FILE_SUFFIX = '.json.gz';
const MOCK_ACCESS_TOKEN = 'kechimochi-e2e-access-token';
const MOCK_REFRESH_TOKEN = 'kechimochi-e2e-refresh-token';
const MOCK_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const REMOTE_DEVICE_ID = 'remote-e2e-device';

type JsonObject = Record<string, unknown>;

type StoredFile = {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    parents: string[];
    bytes: Buffer;
};

type RemoteManifest = {
    sync_protocol_version: number;
    db_schema_version: number;
    profile_id: string;
    profile_name: string;
    snapshot_id: string;
    snapshot_sha256: string;
    remote_generation: number;
    updated_at: string;
    last_writer_device_id: string;
};

type SnapshotMedia = JsonObject & {
    uid: string;
    title: string;
    description: string;
    extra_data: string;
    updated_at: string;
    updated_by_device_id: string;
};

type SyncSnapshot = JsonObject & {
    sync_protocol_version: number;
    db_schema_version: number;
    snapshot_id: string;
    created_at: string;
    created_by_device_id: string;
    profile: JsonObject & {
        profile_id: string;
        profile_name: string;
        updated_at: string;
    };
    library: Record<string, SnapshotMedia>;
    settings: Record<string, JsonObject>;
    tombstones: JsonObject[];
};

type SeedRemoteMedia = {
    title: string;
    description?: string;
    mediaType?: string;
    status?: string;
    language?: string;
    contentType?: string;
    trackingStatus?: string;
    extraData?: Record<string, unknown>;
};

type SyncMockServerConfig = {
    baseUrl: string;
    authEndpoint: string;
    tokenEndpoint: string;
    driveApiBaseUrl: string;
    driveUploadBaseUrl: string;
    clientId: string;
};

type SyncMockState = {
    nextId: number;
    nextTimestamp: number;
    files: Map<string, StoredFile>;
};

let server: Server | null = null;
let serverConfig: SyncMockServerConfig | null = null;
let state: SyncMockState | null = null;

function requireState(): SyncMockState {
    if (!state) {
        throw new Error('Sync mock server is not running');
    }
    return state;
}

function requireConfig(): SyncMockServerConfig {
    if (!serverConfig) {
        throw new Error('Sync mock server is not running');
    }
    return serverConfig;
}

function nextTimestamp(currentState: SyncMockState): string {
    const baseMs = Date.UTC(2026, 3, 2, 0, 0, 0, 0);
    const timestamp = new Date(baseMs + currentState.nextTimestamp * 1000).toISOString();
    currentState.nextTimestamp += 1;
    return timestamp;
}

function fileToJson(file: StoredFile) {
    return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: String(file.bytes.length),
        modifiedTime: file.modifiedTime,
    };
}

function normalizeNameQueryValue(rawQuery: string, operator: 'contains' | '='): string | null {
    const match = (
        operator === 'contains'
            ? /name contains '([^']+)'/
            : /name = '([^']+)'/
    ).exec(rawQuery);
    return match?.[1] ?? null;
}

function fileMatchesQuery(file: StoredFile, rawQuery: string): boolean {
    const exact = normalizeNameQueryValue(rawQuery, '=');
    if (exact) {
        return file.name === exact;
    }

    const contains = normalizeNameQueryValue(rawQuery, 'contains');
    if (contains) {
        return file.name.includes(contains);
    }

    return true;
}

function computeSha256Hex(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function manifestFileName(profileId: string): string {
    return `${MANIFEST_FILE_PREFIX}${profileId}${MANIFEST_FILE_SUFFIX}`;
}

function snapshotFileName(profileId: string, snapshotId: string): string {
    return `${SNAPSHOT_FILE_PREFIX}${profileId}-${snapshotId}${SNAPSHOT_FILE_SUFFIX}`;
}

function parseMultipartRelated(contentType: string, body: Buffer): {
    metadata: { name: string; mimeType: string; parents: string[] };
    bytes: Buffer;
} {
    const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
    if (!boundaryMatch) {
        throw new Error(`Missing multipart boundary in ${contentType}`);
    }

    const boundary = boundaryMatch[1];
    const raw = body.toString('latin1');
    const firstMarker = `--${boundary}\r\n`;
    const secondMarker = `\r\n--${boundary}\r\n`;
    const finalMarker = `\r\n--${boundary}--\r\n`;

    if (!raw.startsWith(firstMarker)) {
        throw new Error('Malformed multipart body');
    }

    const firstHeadersEnd = raw.indexOf('\r\n\r\n', firstMarker.length);
    const firstPartEnd = raw.indexOf(secondMarker, firstHeadersEnd + 4);
    const secondHeadersStart = firstPartEnd + 2;
    const secondHeadersEnd = raw.indexOf('\r\n\r\n', secondHeadersStart);
    const secondBodyStart = secondHeadersEnd + 4;
    const secondBodyEnd = raw.indexOf(finalMarker, secondBodyStart);

    if (
        firstHeadersEnd === -1
        || firstPartEnd === -1
        || secondHeadersEnd === -1
        || secondBodyEnd === -1
    ) {
        throw new Error('Could not parse multipart upload body');
    }

    const metadataJson = raw.slice(firstHeadersEnd + 4, firstPartEnd);
    const parsedMetadata = JSON.parse(metadataJson) as {
        name: string;
        mimeType: string;
        parents?: string[];
    };

    return {
        metadata: {
            name: parsedMetadata.name,
            mimeType: parsedMetadata.mimeType,
            parents: parsedMetadata.parents ?? [],
        },
        bytes: body.subarray(secondBodyStart, secondBodyEnd),
    };
}

function readJson<T>(bytes: Buffer): T {
    return JSON.parse(bytes.toString('utf8')) as T;
}

function writeJson(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function upsertNamedFile(currentState: SyncMockState, name: string, mimeType: string, bytes: Buffer, parents: string[] = []): StoredFile {
    const existing = Array.from(currentState.files.values()).find((file) => file.name === name);
    if (existing) {
        const updated: StoredFile = {
            ...existing,
            mimeType,
            parents,
            bytes,
            modifiedTime: nextTimestamp(currentState),
        };
        currentState.files.set(existing.id, updated);
        return updated;
    }

    currentState.nextId += 1;
    const created: StoredFile = {
        id: `file_${currentState.nextId}`,
        name,
        mimeType,
        parents,
        bytes,
        modifiedTime: nextTimestamp(currentState),
    };
    currentState.files.set(created.id, created);
    return created;
}

function listProfilesFromState(currentState: SyncMockState): Array<{ manifest: RemoteManifest; snapshot: SyncSnapshot }> {
    const manifests = Array.from(currentState.files.values())
        .filter((file) => file.name.startsWith(MANIFEST_FILE_PREFIX))
        .map((file) => readJson<RemoteManifest>(file.bytes));

    return manifests.map((manifest) => ({
        manifest,
        snapshot: readRemoteSnapshotFromState(currentState, manifest.profile_id, manifest.snapshot_id),
    }));
}

function readRemoteSnapshotFromState(currentState: SyncMockState, profileId: string, snapshotId: string): SyncSnapshot {
    const snapshotName = snapshotFileName(profileId, snapshotId);
    const snapshotFile = Array.from(currentState.files.values()).find((file) => file.name === snapshotName);
    if (!snapshotFile) {
        throw new Error(`Missing remote snapshot ${snapshotName}`);
    }
    const jsonBytes = gunzipSync(snapshotFile.bytes);
    return JSON.parse(jsonBytes.toString('utf8')) as SyncSnapshot;
}

function writeRemoteProfileToState(
    currentState: SyncMockState,
    manifest: RemoteManifest,
    snapshot: SyncSnapshot,
): void {
    const snapshotJson = writeJson(snapshot);
    const snapshotSha256 = computeSha256Hex(snapshotJson);
    const snapshotBytes = gzipSync(snapshotJson);
    const normalizedManifest: RemoteManifest = {
        ...manifest,
        profile_name: snapshot.profile.profile_name,
        snapshot_id: snapshot.snapshot_id,
        snapshot_sha256: snapshotSha256,
    };

    upsertNamedFile(
        currentState,
        snapshotFileName(manifest.profile_id, snapshot.snapshot_id),
        'application/gzip',
        snapshotBytes,
        ['appDataFolder'],
    );
    upsertNamedFile(
        currentState,
        manifestFileName(manifest.profile_id),
        'application/json',
        writeJson(normalizedManifest),
        ['appDataFolder'],
    );
}

function createRemoteMutationTimestamp(currentState: SyncMockState): string {
    return nextTimestamp(currentState);
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    const payload = writeJson(body);
    res.writeHead(statusCode, {
        'content-type': 'application/json',
        'content-length': String(payload.length),
    });
    res.end(payload);
}

function sendBytes(res: ServerResponse, statusCode: number, contentType: string, body: Buffer): void {
    res.writeHead(statusCode, {
        'content-type': contentType,
        'content-length': String(body.length),
    });
    res.end(body);
}

function requireAuthorizedRequest(req: IncomingMessage): void {
    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
        throw new Error('Unauthorized request received by sync mock server');
    }
}

async function handleAuthRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
        Logger.info(`[sync-mock] authorize ${url.toString()}`);
        const redirectUri = url.searchParams.get('redirect_uri');
        const stateParam = url.searchParams.get('state');
        if (!redirectUri || !stateParam) {
            sendJson(res, 400, { error: 'missing_redirect_or_state' });
            return true;
        }

        const callbackUrl = new URL(redirectUri);
        callbackUrl.searchParams.set('code', 'kechimochi-e2e-auth-code');
        callbackUrl.searchParams.set('state', stateParam);

        res.writeHead(302, { location: callbackUrl.toString() });
        res.end();
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
        Logger.info('[sync-mock] token exchange');
        const body = await readRequestBody(req);
        const params = new URLSearchParams(body.toString('utf8'));
        const grantType = params.get('grant_type');

        if (grantType === 'authorization_code') {
            sendJson(res, 200, {
                access_token: MOCK_ACCESS_TOKEN,
                expires_in: 3600,
                refresh_token: MOCK_REFRESH_TOKEN,
                scope: MOCK_SCOPE,
                token_type: 'Bearer',
            });
            return true;
        }

        if (grantType === 'refresh_token') {
            sendJson(res, 200, {
                access_token: MOCK_ACCESS_TOKEN,
                expires_in: 3600,
                refresh_token: MOCK_REFRESH_TOKEN,
                scope: MOCK_SCOPE,
                token_type: 'Bearer',
            });
            return true;
        }

        sendJson(res, 400, { error: 'unsupported_grant_type' });
        return true;
    }

    return false;
}

async function handleDriveRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/drive/v3') && !url.pathname.startsWith('/upload/drive/v3')) {
        return false;
    }

    requireAuthorizedRequest(req);
    const currentState = requireState();

    if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
        handleListFiles(currentState, res, url);
        return true;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/drive/v3/files/')) {
        handleDownloadFile(currentState, res, url);
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
        await handleCreateUpload(currentState, req, res);
        return true;
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/upload/drive/v3/files/')) {
        await handleUpdateUpload(currentState, req, res, url);
        return true;
    }

    sendJson(res, 404, { error: 'unsupported_mock_drive_route' });
    return true;
}

function handleListFiles(currentState: SyncMockState, res: ServerResponse, url: URL): void {
    const rawQuery = url.searchParams.get('q');
    const files = Array.from(currentState.files.values())
        .filter((file) => !rawQuery || fileMatchesQuery(file, rawQuery))
        .map(fileToJson);
    sendJson(res, 200, { files });
}

function handleDownloadFile(currentState: SyncMockState, res: ServerResponse, url: URL): void {
    const fileId = url.pathname.split('/').pop() || '';
    const file = currentState.files.get(fileId);
    if (!file) {
        sendJson(res, 404, { error: 'file_not_found' });
        return;
    }

    if (url.searchParams.get('alt') === 'media') {
        sendBytes(res, 200, file.mimeType, file.bytes);
        return;
    }

    sendJson(res, 200, fileToJson(file));
}

async function handleCreateUpload(
    currentState: SyncMockState,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string') {
        sendJson(res, 400, { error: 'missing_content_type' });
        return;
    }

    const body = await readRequestBody(req);
    const { metadata, bytes } = parseMultipartRelated(contentType, body);
    const file = upsertNamedFile(
        currentState,
        metadata.name,
        metadata.mimeType,
        bytes,
        metadata.parents,
    );
    sendJson(res, 200, fileToJson(file));
}

async function handleUpdateUpload(
    currentState: SyncMockState,
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
): Promise<void> {
    const fileId = url.pathname.split('/').pop() || '';
    const existing = currentState.files.get(fileId);
    if (!existing) {
        sendJson(res, 404, { error: 'file_not_found' });
        return;
    }

    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string') {
        sendJson(res, 400, { error: 'missing_content_type' });
        return;
    }

    const body = await readRequestBody(req);
    const { metadata, bytes } = parseMultipartRelated(contentType, body);
    const updated: StoredFile = {
        ...existing,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents.length > 0 ? metadata.parents : existing.parents,
        bytes,
        modifiedTime: nextTimestamp(currentState),
    };
    currentState.files.set(fileId, updated);
    sendJson(res, 200, fileToJson(updated));
}

export async function startSyncMockServer(): Promise<SyncMockServerConfig> {
    if (server && serverConfig) {
        return serverConfig;
    }

    state = {
        nextId: 0,
        nextTimestamp: 0,
        files: new Map(),
    };

    server = createServer(async (req, res) => {
        try {
            const base = requireConfig().baseUrl;
            const url = new URL(req.url || '/', base);
            if (await handleAuthRequest(req, res, url)) {
                return;
            }
            if (await handleDriveRequest(req, res, url)) {
                return;
            }
            sendJson(res, 404, { error: 'not_found' });
        } catch (error) {
            sendJson(res, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    serverConfig = {
        baseUrl,
        authEndpoint: `${baseUrl}/oauth/authorize`,
        tokenEndpoint: `${baseUrl}/oauth/token`,
        driveApiBaseUrl: `${baseUrl}/drive/v3`,
        driveUploadBaseUrl: `${baseUrl}/upload/drive/v3`,
        clientId: 'kechimochi-e2e-client-id',
    };

    return serverConfig;
}

export async function stopSyncMockServer(): Promise<void> {
    await new Promise<void>((resolve) => {
        if (!server) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
    server = null;
    serverConfig = null;
    state = null;
}

export function getSyncMockServerConfig(): SyncMockServerConfig {
    return requireConfig();
}

export function seedRemoteSyncProfile(options?: {
    profileName?: string;
    media?: SeedRemoteMedia[];
    theme?: string;
}): string {
    const currentState = requireState();
    const profileId = `prof_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const snapshotId = `snap_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const createdAt = createRemoteMutationTimestamp(currentState);
    const profileName = options?.profileName ?? 'REMOTEUSER';
    const mediaEntries = options?.media ?? [];
    const library: Record<string, SnapshotMedia> = {};

    for (const entry of mediaEntries) {
        const mediaUid = `uid_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        library[mediaUid] = {
            uid: mediaUid,
            title: entry.title,
            media_type: entry.mediaType ?? 'Reading',
            status: entry.status ?? 'Active',
            language: entry.language ?? 'Japanese',
            description: entry.description ?? '',
            content_type: entry.contentType ?? 'Novel',
            tracking_status: entry.trackingStatus ?? 'Ongoing',
            extra_data: JSON.stringify(entry.extraData ?? {}),
            cover_blob_sha256: null,
            updated_at: createdAt,
            updated_by_device_id: REMOTE_DEVICE_ID,
            activities: [],
            milestones: [],
        };
    }

    const snapshot: SyncSnapshot = {
        sync_protocol_version: 1,
        db_schema_version: 2,
        snapshot_id: snapshotId,
        created_at: createdAt,
        created_by_device_id: REMOTE_DEVICE_ID,
        profile: {
            profile_id: profileId,
            profile_name: profileName,
            updated_at: createdAt,
        },
        library,
        settings: options?.theme
            ? {
                theme: {
                    value: options.theme,
                    updated_at: createdAt,
                    updated_by_device_id: REMOTE_DEVICE_ID,
                },
            }
            : {},
        tombstones: [],
    };

    const manifest: RemoteManifest = {
        sync_protocol_version: snapshot.sync_protocol_version,
        db_schema_version: snapshot.db_schema_version,
        profile_id: profileId,
        profile_name: profileName,
        snapshot_id: snapshotId,
        snapshot_sha256: '',
        remote_generation: 1,
        updated_at: createdAt,
        last_writer_device_id: REMOTE_DEVICE_ID,
    };

    writeRemoteProfileToState(currentState, manifest, snapshot);
    return profileId;
}

function listRemoteProfilesInternal(): Array<{ manifest: RemoteManifest; snapshot: SyncSnapshot }> {
    return listProfilesFromState(requireState());
}

export async function waitForRemoteProfileCount(expectedCount: number, timeoutMs = 10_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (listRemoteProfilesInternal().length === expectedCount) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${expectedCount} remote profile(s)`);
}

export function getSingleRemoteProfileId(): string {
    const profiles = listRemoteProfilesInternal();
    if (profiles.length !== 1) {
        throw new Error(`Expected exactly one remote profile, found ${profiles.length}`);
    }
    return profiles[0].manifest.profile_id;
}

export function readRemoteProfile(profileId: string): { manifest: RemoteManifest; snapshot: SyncSnapshot } {
    const profile = listRemoteProfilesInternal().find((entry) => entry.manifest.profile_id === profileId);
    if (!profile) {
        throw new Error(`Remote profile ${profileId} not found`);
    }
    return {
        manifest: structuredClone(profile.manifest),
        snapshot: structuredClone(profile.snapshot),
    };
}

function findMediaEntry(snapshot: SyncSnapshot, title: string): SnapshotMedia {
    const entry = Object.values(snapshot.library).find((media) => media.title === title);
    if (!entry) {
        throw new Error(`Remote media "${title}" not found`);
    }
    return entry;
}

function commitRemoteProfileMutation(
    profileId: string,
    mutate: (snapshot: SyncSnapshot) => void,
    writerDeviceId = REMOTE_DEVICE_ID,
): { manifest: RemoteManifest; snapshot: SyncSnapshot } {
    const currentState = requireState();
    const { manifest, snapshot } = readRemoteProfile(profileId);
    const nextTimestampValue = createRemoteMutationTimestamp(currentState);
    const nextSnapshotId = `snap_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

    const nextSnapshot = structuredClone(snapshot);
    nextSnapshot.snapshot_id = nextSnapshotId;
    nextSnapshot.created_at = nextTimestampValue;
    nextSnapshot.created_by_device_id = writerDeviceId;
    mutate(nextSnapshot);

    const nextManifest: RemoteManifest = {
        ...manifest,
        remote_generation: manifest.remote_generation + 1,
        snapshot_id: nextSnapshotId,
        updated_at: nextTimestampValue,
        last_writer_device_id: writerDeviceId,
    };

    writeRemoteProfileToState(currentState, nextManifest, nextSnapshot);
    return readRemoteProfile(profileId);
}

export function setRemoteMediaDescription(profileId: string, title: string, description: string): void {
    commitRemoteProfileMutation(profileId, (snapshot) => {
        const media = findMediaEntry(snapshot, title);
        media.description = description;
        media.updated_at = snapshot.created_at;
        media.updated_by_device_id = REMOTE_DEVICE_ID;
    });
}

export function setRemoteExtraDataEntry(
    profileId: string,
    title: string,
    key: string,
    value: string | null,
): void {
    commitRemoteProfileMutation(profileId, (snapshot) => {
        const media = findMediaEntry(snapshot, title);
        const extraData = JSON.parse(media.extra_data || '{}') as Record<string, unknown>;
        if (value === null) {
            delete extraData[key];
        } else {
            extraData[key] = value;
        }
        media.extra_data = JSON.stringify(extraData);
        media.updated_at = snapshot.created_at;
        media.updated_by_device_id = REMOTE_DEVICE_ID;
    });
}

export function getRemoteMedia(profileId: string, title: string): SnapshotMedia {
    const { snapshot } = readRemoteProfile(profileId);
    return structuredClone(findMediaEntry(snapshot, title));
}

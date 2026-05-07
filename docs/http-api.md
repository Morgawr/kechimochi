# HTTP API

Kechimochi desktop builds can expose an optional unauthenticated HTTP API for automation. Start or stop it from the top-level **HTTP API** switch in the profile tab. Configure LAN access, port, scope, and browser CORS origins under **HTTP API** -> **Advanced settings**.

This API is intended for trusted local automation. Any process that can reach the listener can read and change Kechimochi data. Keep it disabled unless you are actively using it.

## Availability

- Desktop builds can enable the HTTP API from the profile tab.
- Android and web builds do not expose the profile-tab HTTP API controls.
- The default port is `3031`.
- Saving advanced settings restarts the listener when it is already running. If the listener is stopped, saving advanced settings only persists the settings; it does not start the API.
- The API has two scopes:
  - `automation`: everyday media, activity, milestone, settings, username, version, and read-only profile-picture endpoints.
  - `full`: everything in `automation`, plus import, export, reset, cover upload/download, profile-picture write/delete, and network proxy endpoints.

## Local vs LAN Mode

Local mode binds the API to `127.0.0.1`. Only programs on the same computer can connect to it. Host-header validation allows `localhost`, `127.0.0.1`, and `::1`.

LAN mode binds the API to `0.0.0.0`. Other devices on the same private network can connect by using the desktop machine's LAN IP address, for example `http://192.168.1.50:3031`. Host-header validation allows loopback, private IPv4, link-local IPv4, IPv6 unique-local, and IPv6 link-local addresses.

The profile tab shows a loopback URL such as `http://127.0.0.1:3031` because that URL works from the desktop itself. From another device, replace `127.0.0.1` with the desktop machine's LAN IP address.

Changing between local mode and LAN mode restarts the listener. If the API is already running, Kechimochi stops the existing listener first, waits for it to shut down, and then starts the listener again with the new bind address.

## Access

Set a base URL in your shell:

```sh
BASE=http://127.0.0.1:3031
```

For LAN access from another device:

```sh
BASE=http://192.168.1.50:3031
```

JSON requests use `Content-Type: application/json`. CLI clients such as `curl` do not need CORS configuration. Browser scripts must list their exact origin in **Allowed Browser Origins**.

## Automation Scope Endpoints

These endpoints are available in both `automation` and `full` scope.

| Endpoint | Description | Example |
| :--- | :--- | :--- |
| `GET /api/version` | Return the HTTP API version string. | `curl -s "$BASE/api/version"` |
| `GET /api/username` | Return the OS username fallback used by the app. | `curl -s "$BASE/api/username"` |
| `GET /api/settings/:key` | Read a setting value. Returns JSON `null` if unset. | `curl -s "$BASE/api/settings/theme"` |
| `PUT /api/settings/:key` | Set a setting value. | `curl -s -X PUT "$BASE/api/settings/theme" -H 'Content-Type: application/json' -d '{"value":"dark"}'` |
| `POST /api/profiles/initialize` | Initialize the user database when no profile database exists. | `curl -s -X POST "$BASE/api/profiles/initialize" -H 'Content-Type: application/json' -d '{"fallback_username":"morg"}'` |
| `GET /api/profile-picture` | Read the stored profile picture metadata and base64 data. | `curl -s "$BASE/api/profile-picture"` |
| `GET /api/media` | List all media. | `curl -s "$BASE/api/media"` |
| `POST /api/media` | Add media. Returns the new ID. | `curl -s -X POST "$BASE/api/media" -H 'Content-Type: application/json' -d '{"id":null,"title":"Example Book","media_type":"Reading","status":"Active","language":"Japanese","description":"","cover_image":"","extra_data":"{}","content_type":"Novel","tracking_status":"Ongoing"}'` |
| `PUT /api/media/:id` | Replace media by ID. The URL ID is authoritative. | `curl -s -X PUT "$BASE/api/media/1" -H 'Content-Type: application/json' -d '{"id":1,"title":"Example Book","media_type":"Reading","status":"Active","language":"Japanese","description":"Updated","cover_image":"","extra_data":"{}","content_type":"Novel","tracking_status":"Ongoing"}'` |
| `DELETE /api/media/:id` | Delete media by ID. | `curl -s -X DELETE "$BASE/api/media/1"` |
| `GET /api/logs` | List activity logs. | `curl -s "$BASE/api/logs"` |
| `POST /api/logs` | Add an activity log. Returns the new ID. | `curl -s -X POST "$BASE/api/logs" -H 'Content-Type: application/json' -d '{"id":null,"media_id":1,"duration_minutes":30,"characters":0,"date":"2026-05-07","activity_type":"Reading"}'` |
| `PUT /api/logs/:id` | Replace an activity log by ID. The URL ID is authoritative. | `curl -s -X PUT "$BASE/api/logs/1" -H 'Content-Type: application/json' -d '{"id":1,"media_id":1,"duration_minutes":45,"characters":1000,"date":"2026-05-07","activity_type":"Reading"}'` |
| `DELETE /api/logs/:id` | Delete an activity log by ID. | `curl -s -X DELETE "$BASE/api/logs/1"` |
| `GET /api/logs/heatmap` | Return daily aggregate activity totals. | `curl -s "$BASE/api/logs/heatmap"` |
| `GET /api/logs/media/:id` | List activity summaries for one media item. | `curl -s "$BASE/api/logs/media/1"` |
| `GET /api/timeline` | Return timeline events. | `curl -s "$BASE/api/timeline"` |
| `POST /api/milestones` | Add a milestone. Returns the new ID. | `curl -s -X POST "$BASE/api/milestones" -H 'Content-Type: application/json' -d '{"id":null,"media_uid":null,"media_title":"Example Book","name":"Volume 1","duration":120,"characters":5000,"date":"2026-05-07"}'` |
| `GET /api/milestones/media/:title` | List milestones for a media title. URL-encode the title. | `curl -s "$BASE/api/milestones/media/Example%20Book"` |
| `DELETE /api/milestones/media/:title` | Delete all milestones for a media title. | `curl -s -X DELETE "$BASE/api/milestones/media/Example%20Book"` |
| `PUT /api/milestones/:id` | Replace a milestone by ID. The URL ID is authoritative. | `curl -s -X PUT "$BASE/api/milestones/1" -H 'Content-Type: application/json' -d '{"id":1,"media_uid":null,"media_title":"Example Book","name":"Volume 2","duration":240,"characters":10000,"date":"2026-05-08"}'` |
| `DELETE /api/milestones/:id` | Delete one milestone. | `curl -s -X DELETE "$BASE/api/milestones/1"` |

## Full Scope Endpoints

These endpoints are available only when API Scope is set to `full`.

| Endpoint | Description | Example |
| :--- | :--- | :--- |
| `POST /api/activities/clear` | Delete all activity logs. | `curl -s -X POST "$BASE/api/activities/clear"` |
| `POST /api/reset` | Wipe local application data and sync runtime files. | `curl -s -X POST "$BASE/api/reset"` |
| `POST /api/profile-picture` | Upload a profile picture with multipart form data. | `curl -s -X POST "$BASE/api/profile-picture" -F "file=@avatar.png"` |
| `DELETE /api/profile-picture` | Delete the stored profile picture. | `curl -s -X DELETE "$BASE/api/profile-picture"` |
| `POST /api/import/activities` | Import activity logs from CSV. | `curl -s -X POST "$BASE/api/import/activities" -F "file=@activities.csv"` |
| `GET /api/export/activities` | Export activity logs as CSV. Optional `start` and `end` query parameters filter by date. | `curl -s "$BASE/api/export/activities?start=2026-01-01&end=2026-01-31" -o activities.csv` |
| `POST /api/import/media/analyze` | Analyze a media-library CSV and return conflicts. | `curl -s -X POST "$BASE/api/import/media/analyze" -F "file=@media_library.csv"` |
| `POST /api/import/media/apply` | Apply approved media CSV rows. | `curl -s -X POST "$BASE/api/import/media/apply" -H 'Content-Type: application/json' -d '[{"Title":"New Media","Media Type":"Reading","Status":"Active","Language":"Japanese","Description":"","Content Type":"Novel","Extra Data":"{}","Cover Image (Base64)":""}]'` |
| `GET /api/export/media` | Export the media library as CSV. | `curl -s "$BASE/api/export/media" -o media_library.csv` |
| `POST /api/import/milestones` | Import milestones from CSV. | `curl -s -X POST "$BASE/api/import/milestones" -F "file=@milestones.csv"` |
| `GET /api/export/milestones` | Export milestones as CSV. | `curl -s "$BASE/api/export/milestones" -o milestones.csv` |
| `POST /api/export/full-backup` | Export a ZIP backup. The request supplies local-storage JSON and the app version string. | `curl -s -X POST "$BASE/api/export/full-backup" -H 'Content-Type: application/json' -d '{"local_storage":"{}","version":"0.2.9"}' -o full_backup.zip` |
| `POST /api/import/full-backup` | Import a ZIP backup. Returns JSON with `localStorage`. | `curl -s -X POST "$BASE/api/import/full-backup" -F "file=@full_backup.zip"` |
| `POST /api/covers/download` | Download a remote cover image and attach it to media. | `curl -s -X POST "$BASE/api/covers/download" -H 'Content-Type: application/json' -d '{"media_id":1,"url":"https://example.com/cover.jpg"}'` |
| `GET /api/covers/file/:filename` | Read a stored cover file by filename. | `curl -s "$BASE/api/covers/file/cover.jpg" -o cover.jpg` |
| `POST /api/covers/:media_id` | Upload a cover image for one media item. | `curl -s -X POST "$BASE/api/covers/1" -F "file=@cover.jpg"` |
| `POST /api/fetch/json` | Fetch external JSON/text through the desktop backend. | `curl -s -X POST "$BASE/api/fetch/json" -H 'Content-Type: application/json' -d '{"url":"https://example.com/data.json","method":"GET","body":null,"headers":null}'` |
| `POST /api/fetch/bytes` | Fetch remote bytes through the desktop backend. The response is JSON with a `bytes` array. | `curl -s -X POST "$BASE/api/fetch/bytes" -H 'Content-Type: application/json' -d '{"url":"https://example.com/image.jpg"}'` |

## JSON Shapes

Media payloads use these fields:

```json
{
  "id": null,
  "title": "Example Book",
  "media_type": "Reading",
  "status": "Active",
  "language": "Japanese",
  "description": "",
  "cover_image": "",
  "extra_data": "{}",
  "content_type": "Novel",
  "tracking_status": "Ongoing"
}
```

Activity log payloads use these fields:

```json
{
  "id": null,
  "media_id": 1,
  "duration_minutes": 30,
  "characters": 0,
  "date": "2026-05-07",
  "activity_type": "Reading"
}
```

Milestone payloads use these fields:

```json
{
  "id": null,
  "media_uid": null,
  "media_title": "Example Book",
  "name": "Volume 1",
  "duration": 120,
  "characters": 5000,
  "date": "2026-05-07"
}
```

## Error Behavior

Unmatched `/api` routes return `404` with `API route not found`.

Handler failures return `500` with a plain-text error message. Host-header validation failures return `403`.

Mutating endpoints mark the current sync profile dirty when cloud sync is configured, so changes made through the HTTP API are picked up by later sync runs.

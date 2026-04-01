use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::db;
use crate::sync_snapshot::{
    SnapshotActivity, SnapshotMediaAggregate, SnapshotMilestone, SnapshotProfile,
    SnapshotProfilePicture, SnapshotSettingValue, SnapshotTombstone, SyncSnapshot,
    SYNC_PROTOCOL_VERSION,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MergeSide {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncConflict {
    MediaFieldConflict {
        media_uid: String,
        field_name: String,
        base_value: Option<String>,
        local_value: Option<String>,
        remote_value: Option<String>,
    },
    DeleteVsUpdate {
        media_uid: String,
        deleted_side: MergeSide,
        tombstone: SnapshotTombstone,
        base_media: Box<Option<SnapshotMediaAggregate>>,
        local_media: Box<Option<SnapshotMediaAggregate>>,
        remote_media: Box<Option<SnapshotMediaAggregate>>,
    },
    ProfilePictureConflict {
        base_picture: Box<Option<SnapshotProfilePicture>>,
        local_picture: Box<Option<SnapshotProfilePicture>>,
        remote_picture: Box<Option<SnapshotProfilePicture>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncMergeOutcome {
    pub merged_snapshot: SyncSnapshot,
    pub conflicts: Vec<SyncConflict>,
}

impl SyncMergeOutcome {
    pub fn can_publish(&self) -> bool {
        self.conflicts.is_empty()
    }
}

#[derive(Debug, Clone)]
struct MediaMergeResult {
    media: Option<SnapshotMediaAggregate>,
    tombstone: Option<SnapshotTombstone>,
    conflicts: Vec<SyncConflict>,
}

pub fn merge_snapshots(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> Result<SyncMergeOutcome, String> {
    validate_merge_inputs(base, local, remote)?;

    let mut merged_snapshot = local.clone();
    let mut merged_library = BTreeMap::new();
    let mut merged_tombstones: BTreeMap<String, SnapshotTombstone> = BTreeMap::new();
    let mut conflicts = Vec::new();

    let all_media_uids = collect_all_media_uids(base, local, remote);
    let base_tombstones = tombstone_map(base);
    let local_tombstones = tombstone_map(Some(local));
    let remote_tombstones = tombstone_map(Some(remote));

    for uid in all_media_uids {
        let base_media = base.and_then(|snapshot| snapshot.library.get(&uid));
        let local_media = local.library.get(&uid);
        let remote_media = remote.library.get(&uid);
        let local_tombstone = local_tombstones.get(&uid);
        let remote_tombstone = remote_tombstones.get(&uid);
        let base_tombstone = base_tombstones.get(&uid);

        let result = merge_media_uid(
            &uid,
            base_media,
            local_media,
            remote_media,
            local_tombstone,
            remote_tombstone,
            base_tombstone,
        );

        if let Some(media) = result.media {
            merged_library.insert(uid.clone(), media);
        }
        if let Some(tombstone) = result.tombstone {
            merged_tombstones.insert(uid.clone(), tombstone);
        }
        conflicts.extend(result.conflicts);
    }

    let merged_settings = merge_settings(base, local, remote);
    let merged_profile = merge_profile(base, local, remote);
    let (merged_profile_picture, picture_conflict) = merge_profile_picture(base, local, remote);
    if let Some(conflict) = picture_conflict {
        conflicts.push(conflict);
    }

    for tombstone in local_tombstones.values().chain(remote_tombstones.values()) {
        if !merged_library.contains_key(&tombstone.media_uid) {
            let entry = merged_tombstones
                .entry(tombstone.media_uid.clone())
                .or_insert_with(|| tombstone.clone());
            if compare_tombstones(tombstone, entry) == Ordering::Greater {
                *entry = tombstone.clone();
            }
        }
    }

    merged_snapshot.profile = merged_profile;
    merged_snapshot.library = merged_library;
    merged_snapshot.settings = merged_settings;
    merged_snapshot.profile_picture = merged_profile_picture;
    merged_snapshot.tombstones = merged_tombstones.into_values().collect();

    Ok(SyncMergeOutcome {
        merged_snapshot,
        conflicts,
    })
}

fn validate_merge_inputs(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> Result<(), String> {
    let snapshots = base.into_iter().chain([local, remote]);
    for snapshot in snapshots {
        if snapshot.sync_protocol_version != SYNC_PROTOCOL_VERSION {
            return Err(format!(
                "Unsupported sync protocol version {}",
                snapshot.sync_protocol_version
            ));
        }
        if snapshot.db_schema_version != db::CURRENT_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported db schema version {}",
                snapshot.db_schema_version
            ));
        }
    }

    let profile_id = &local.profile.profile_id;
    if &remote.profile.profile_id != profile_id {
        return Err(format!(
            "Snapshot profile mismatch: local={} remote={}",
            profile_id, remote.profile.profile_id
        ));
    }
    if let Some(base) = base {
        if &base.profile.profile_id != profile_id {
            return Err(format!(
                "Snapshot profile mismatch: local={} base={}",
                profile_id, base.profile.profile_id
            ));
        }
    }

    Ok(())
}

fn collect_all_media_uids(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> BTreeSet<String> {
    let mut uids = BTreeSet::new();
    if let Some(base) = base {
        uids.extend(base.library.keys().cloned());
        uids.extend(base.tombstones.iter().map(|t| t.media_uid.clone()));
    }
    uids.extend(local.library.keys().cloned());
    uids.extend(remote.library.keys().cloned());
    uids.extend(local.tombstones.iter().map(|t| t.media_uid.clone()));
    uids.extend(remote.tombstones.iter().map(|t| t.media_uid.clone()));
    uids
}

fn tombstone_map(snapshot: Option<&SyncSnapshot>) -> BTreeMap<String, SnapshotTombstone> {
    let mut tombstones = BTreeMap::new();
    let Some(snapshot) = snapshot else {
        return tombstones;
    };

    for tombstone in &snapshot.tombstones {
        let entry = tombstones
            .entry(tombstone.media_uid.clone())
            .or_insert_with(|| tombstone.clone());
        if compare_tombstones(tombstone, entry) == Ordering::Greater {
            *entry = tombstone.clone();
        }
    }

    tombstones
}

fn compare_tombstones(left: &SnapshotTombstone, right: &SnapshotTombstone) -> Ordering {
    left.deleted_at
        .cmp(&right.deleted_at)
        .then_with(|| left.deleted_by_device_id.cmp(&right.deleted_by_device_id))
}

fn merge_media_uid(
    uid: &str,
    base: Option<&SnapshotMediaAggregate>,
    local: Option<&SnapshotMediaAggregate>,
    remote: Option<&SnapshotMediaAggregate>,
    local_tombstone: Option<&SnapshotTombstone>,
    remote_tombstone: Option<&SnapshotTombstone>,
    _base_tombstone: Option<&SnapshotTombstone>,
) -> MediaMergeResult {
    match (base, local, remote) {
        (Some(base), Some(local), Some(remote)) => merge_media_three_way(uid, base, local, remote),
        (Some(base), Some(local), None) => {
            if let Some(tombstone) = remote_tombstone {
                if media_content_eq_ignoring_meta(base, local) {
                    MediaMergeResult {
                        media: None,
                        tombstone: Some(tombstone.clone()),
                        conflicts: Vec::new(),
                    }
                } else {
                    MediaMergeResult {
                        media: Some(local.clone()),
                        tombstone: None,
                        conflicts: vec![SyncConflict::DeleteVsUpdate {
                            media_uid: uid.to_string(),
                            deleted_side: MergeSide::Remote,
                            tombstone: tombstone.clone(),
                            base_media: Box::new(Some(base.clone())),
                            local_media: Box::new(Some(local.clone())),
                            remote_media: Box::new(None),
                        }],
                    }
                }
            } else {
                MediaMergeResult {
                    media: Some(local.clone()),
                    tombstone: None,
                    conflicts: Vec::new(),
                }
            }
        }
        (Some(base), None, Some(remote)) => {
            if let Some(tombstone) = local_tombstone {
                if media_content_eq_ignoring_meta(base, remote) {
                    MediaMergeResult {
                        media: None,
                        tombstone: Some(tombstone.clone()),
                        conflicts: Vec::new(),
                    }
                } else {
                    MediaMergeResult {
                        media: None,
                        tombstone: Some(tombstone.clone()),
                        conflicts: vec![SyncConflict::DeleteVsUpdate {
                            media_uid: uid.to_string(),
                            deleted_side: MergeSide::Local,
                            tombstone: tombstone.clone(),
                            base_media: Box::new(Some(base.clone())),
                            local_media: Box::new(None),
                            remote_media: Box::new(Some(remote.clone())),
                        }],
                    }
                }
            } else {
                MediaMergeResult {
                    media: Some(remote.clone()),
                    tombstone: None,
                    conflicts: Vec::new(),
                }
            }
        }
        (Some(_base), None, None) => MediaMergeResult {
            media: None,
            tombstone: select_latest_tombstone(local_tombstone, remote_tombstone).cloned(),
            conflicts: Vec::new(),
        },
        (None, Some(local), Some(remote)) => merge_media_created_on_both(uid, local, remote),
        (None, Some(local), None) => MediaMergeResult {
            media: Some(local.clone()),
            tombstone: None,
            conflicts: Vec::new(),
        },
        (None, None, Some(remote)) => MediaMergeResult {
            media: Some(remote.clone()),
            tombstone: None,
            conflicts: Vec::new(),
        },
        (None, None, None) => MediaMergeResult {
            media: None,
            tombstone: select_latest_tombstone(local_tombstone, remote_tombstone).cloned(),
            conflicts: Vec::new(),
        },
    }
}

fn select_latest_tombstone<'a>(
    left: Option<&'a SnapshotTombstone>,
    right: Option<&'a SnapshotTombstone>,
) -> Option<&'a SnapshotTombstone> {
    match (left, right) {
        (Some(left), Some(right)) => {
            if compare_tombstones(left, right) == Ordering::Greater {
                Some(left)
            } else {
                Some(right)
            }
        }
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn merge_media_three_way(
    uid: &str,
    base: &SnapshotMediaAggregate,
    local: &SnapshotMediaAggregate,
    remote: &SnapshotMediaAggregate,
) -> MediaMergeResult {
    let mut conflicts = Vec::new();
    let title = merge_scalar_field(
        uid,
        "title",
        Some(&base.title),
        &local.title,
        &remote.title,
        &mut conflicts,
    );
    let media_type = merge_scalar_field(
        uid,
        "media_type",
        Some(&base.media_type),
        &local.media_type,
        &remote.media_type,
        &mut conflicts,
    );
    let status = merge_scalar_field(
        uid,
        "status",
        Some(&base.status),
        &local.status,
        &remote.status,
        &mut conflicts,
    );
    let language = merge_scalar_field(
        uid,
        "language",
        Some(&base.language),
        &local.language,
        &remote.language,
        &mut conflicts,
    );
    let description = merge_scalar_field(
        uid,
        "description",
        Some(&base.description),
        &local.description,
        &remote.description,
        &mut conflicts,
    );
    let content_type = merge_scalar_field(
        uid,
        "content_type",
        Some(&base.content_type),
        &local.content_type,
        &remote.content_type,
        &mut conflicts,
    );
    let tracking_status = merge_scalar_field(
        uid,
        "tracking_status",
        Some(&base.tracking_status),
        &local.tracking_status,
        &remote.tracking_status,
        &mut conflicts,
    );
    let extra_data = merge_scalar_field(
        uid,
        "extra_data",
        Some(&base.extra_data),
        &local.extra_data,
        &remote.extra_data,
        &mut conflicts,
    );
    let cover_blob_sha256 = merge_optional_scalar_field(
        uid,
        "cover_blob_sha256",
        base.cover_blob_sha256.as_ref(),
        local.cover_blob_sha256.as_ref(),
        remote.cover_blob_sha256.as_ref(),
        &mut conflicts,
    );

    let activities = merge_multiset_collections(
        &base.activities,
        &local.activities,
        &remote.activities,
        activity_sort,
    );
    let milestones = merge_multiset_collections(
        &base.milestones,
        &local.milestones,
        &remote.milestones,
        milestone_sort,
    );

    let mut merged = SnapshotMediaAggregate {
        uid: uid.to_string(),
        title,
        media_type,
        status,
        language,
        description,
        content_type,
        tracking_status,
        extra_data,
        cover_blob_sha256,
        updated_at: String::new(),
        updated_by_device_id: String::new(),
        activities,
        milestones,
    };

    let meta = choose_media_metadata(local, remote, &merged);
    merged.updated_at = meta.updated_at;
    merged.updated_by_device_id = meta.updated_by_device_id;

    MediaMergeResult {
        media: Some(merged),
        tombstone: None,
        conflicts,
    }
}

fn merge_media_created_on_both(
    uid: &str,
    local: &SnapshotMediaAggregate,
    remote: &SnapshotMediaAggregate,
) -> MediaMergeResult {
    let mut conflicts = Vec::new();
    let title = merge_scalar_field(
        uid,
        "title",
        None,
        &local.title,
        &remote.title,
        &mut conflicts,
    );
    let media_type = merge_scalar_field(
        uid,
        "media_type",
        None,
        &local.media_type,
        &remote.media_type,
        &mut conflicts,
    );
    let status = merge_scalar_field(
        uid,
        "status",
        None,
        &local.status,
        &remote.status,
        &mut conflicts,
    );
    let language = merge_scalar_field(
        uid,
        "language",
        None,
        &local.language,
        &remote.language,
        &mut conflicts,
    );
    let description = merge_scalar_field(
        uid,
        "description",
        None,
        &local.description,
        &remote.description,
        &mut conflicts,
    );
    let content_type = merge_scalar_field(
        uid,
        "content_type",
        None,
        &local.content_type,
        &remote.content_type,
        &mut conflicts,
    );
    let tracking_status = merge_scalar_field(
        uid,
        "tracking_status",
        None,
        &local.tracking_status,
        &remote.tracking_status,
        &mut conflicts,
    );
    let extra_data = merge_scalar_field(
        uid,
        "extra_data",
        None,
        &local.extra_data,
        &remote.extra_data,
        &mut conflicts,
    );
    let cover_blob_sha256 = merge_optional_scalar_field(
        uid,
        "cover_blob_sha256",
        None,
        local.cover_blob_sha256.as_ref(),
        remote.cover_blob_sha256.as_ref(),
        &mut conflicts,
    );

    let activities =
        merge_multiset_collections(&[], &local.activities, &remote.activities, activity_sort);
    let milestones =
        merge_multiset_collections(&[], &local.milestones, &remote.milestones, milestone_sort);

    let mut merged = SnapshotMediaAggregate {
        uid: uid.to_string(),
        title,
        media_type,
        status,
        language,
        description,
        content_type,
        tracking_status,
        extra_data,
        cover_blob_sha256,
        updated_at: String::new(),
        updated_by_device_id: String::new(),
        activities,
        milestones,
    };

    let meta = choose_media_metadata(local, remote, &merged);
    merged.updated_at = meta.updated_at;
    merged.updated_by_device_id = meta.updated_by_device_id;

    MediaMergeResult {
        media: Some(merged),
        tombstone: None,
        conflicts,
    }
}

fn merge_scalar_field(
    media_uid: &str,
    field_name: &str,
    base: Option<&String>,
    local: &String,
    remote: &String,
    conflicts: &mut Vec<SyncConflict>,
) -> String {
    match base {
        Some(base) => {
            if local == base {
                remote.clone()
            } else if remote == base || local == remote {
                local.clone()
            } else {
                conflicts.push(SyncConflict::MediaFieldConflict {
                    media_uid: media_uid.to_string(),
                    field_name: field_name.to_string(),
                    base_value: Some(base.clone()),
                    local_value: Some(local.clone()),
                    remote_value: Some(remote.clone()),
                });
                local.clone()
            }
        }
        None => {
            if local == remote {
                local.clone()
            } else {
                conflicts.push(SyncConflict::MediaFieldConflict {
                    media_uid: media_uid.to_string(),
                    field_name: field_name.to_string(),
                    base_value: None,
                    local_value: Some(local.clone()),
                    remote_value: Some(remote.clone()),
                });
                local.clone()
            }
        }
    }
}

fn merge_optional_scalar_field(
    media_uid: &str,
    field_name: &str,
    base: Option<&String>,
    local: Option<&String>,
    remote: Option<&String>,
    conflicts: &mut Vec<SyncConflict>,
) -> Option<String> {
    match base {
        Some(base) => {
            if local == Some(base) {
                remote.cloned()
            } else if remote == Some(base) || local == remote {
                local.cloned()
            } else {
                conflicts.push(SyncConflict::MediaFieldConflict {
                    media_uid: media_uid.to_string(),
                    field_name: field_name.to_string(),
                    base_value: Some(base.clone()),
                    local_value: local.cloned(),
                    remote_value: remote.cloned(),
                });
                local.cloned()
            }
        }
        None => {
            if local == remote {
                local.cloned()
            } else {
                conflicts.push(SyncConflict::MediaFieldConflict {
                    media_uid: media_uid.to_string(),
                    field_name: field_name.to_string(),
                    base_value: None,
                    local_value: local.cloned(),
                    remote_value: remote.cloned(),
                });
                local.cloned()
            }
        }
    }
}

fn choose_media_metadata(
    local: &SnapshotMediaAggregate,
    remote: &SnapshotMediaAggregate,
    merged: &SnapshotMediaAggregate,
) -> MediaMetadata {
    let merged_equals_local = media_content_eq_ignoring_meta(merged, local);
    let merged_equals_remote = media_content_eq_ignoring_meta(merged, remote);

    if merged_equals_local && !merged_equals_remote {
        MediaMetadata {
            updated_at: local.updated_at.clone(),
            updated_by_device_id: local.updated_by_device_id.clone(),
        }
    } else if merged_equals_remote && !merged_equals_local {
        MediaMetadata {
            updated_at: remote.updated_at.clone(),
            updated_by_device_id: remote.updated_by_device_id.clone(),
        }
    } else {
        choose_later_media_metadata(local, remote)
    }
}

#[derive(Debug, Clone)]
struct MediaMetadata {
    updated_at: String,
    updated_by_device_id: String,
}

fn choose_later_media_metadata(
    local: &SnapshotMediaAggregate,
    remote: &SnapshotMediaAggregate,
) -> MediaMetadata {
    if compare_timestamp_and_device(
        &local.updated_at,
        &local.updated_by_device_id,
        &remote.updated_at,
        &remote.updated_by_device_id,
    ) == Ordering::Greater
    {
        MediaMetadata {
            updated_at: local.updated_at.clone(),
            updated_by_device_id: local.updated_by_device_id.clone(),
        }
    } else {
        MediaMetadata {
            updated_at: remote.updated_at.clone(),
            updated_by_device_id: remote.updated_by_device_id.clone(),
        }
    }
}

fn merge_multiset_collections<T, F>(base: &[T], local: &[T], remote: &[T], sort_fn: F) -> Vec<T>
where
    T: Clone + Eq + std::hash::Hash,
    F: Fn(&T, &T) -> Ordering,
{
    let base_counts = count_values(base);
    let local_counts = count_values(local);
    let remote_counts = count_values(remote);

    let mut all_values = HashSet::new();
    all_values.extend(base_counts.keys().cloned());
    all_values.extend(local_counts.keys().cloned());
    all_values.extend(remote_counts.keys().cloned());

    let mut merged = Vec::new();
    for value in all_values {
        let base_count = *base_counts.get(&value).unwrap_or(&0);
        let local_count = *local_counts.get(&value).unwrap_or(&0);
        let remote_count = *remote_counts.get(&value).unwrap_or(&0);

        let local_added = local_count.saturating_sub(base_count);
        let remote_added = remote_count.saturating_sub(base_count);
        let local_removed = base_count.saturating_sub(local_count);
        let remote_removed = base_count.saturating_sub(remote_count);

        let merged_count = base_count
            .saturating_add(local_added.max(remote_added))
            .saturating_sub(local_removed.saturating_add(remote_removed));

        for _ in 0..merged_count {
            merged.push(value.clone());
        }
    }

    merged.sort_by(sort_fn);
    merged
}

fn count_values<T>(values: &[T]) -> HashMap<T, usize>
where
    T: Clone + Eq + std::hash::Hash,
{
    let mut counts = HashMap::new();
    for value in values {
        *counts.entry(value.clone()).or_insert(0) += 1;
    }
    counts
}

fn merge_settings(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> BTreeMap<String, SnapshotSettingValue> {
    let mut keys = BTreeSet::new();
    if let Some(base) = base {
        keys.extend(base.settings.keys().cloned());
    }
    keys.extend(local.settings.keys().cloned());
    keys.extend(remote.settings.keys().cloned());

    let mut merged = BTreeMap::new();
    for key in keys {
        let chosen = choose_lww_setting_value(
            base.and_then(|snapshot| snapshot.settings.get(&key)),
            local.settings.get(&key),
            remote.settings.get(&key),
        );

        if let Some(chosen) = chosen {
            merged.insert(key, chosen);
        }
    }

    merged
}

fn choose_lww_setting_value(
    base: Option<&SnapshotSettingValue>,
    local: Option<&SnapshotSettingValue>,
    remote: Option<&SnapshotSettingValue>,
) -> Option<SnapshotSettingValue> {
    let local_changed = local != base;
    let remote_changed = remote != base;

    match (local_changed, remote_changed) {
        (false, false) => base
            .cloned()
            .or_else(|| local.cloned())
            .or_else(|| remote.cloned()),
        (true, false) => local.cloned(),
        (false, true) => remote.cloned(),
        (true, true) => match (local, remote) {
            (Some(local), Some(remote)) => {
                if local.value == remote.value {
                    if compare_timestamp_and_device(
                        &local.updated_at,
                        &local.updated_by_device_id,
                        &remote.updated_at,
                        &remote.updated_by_device_id,
                    ) == Ordering::Greater
                    {
                        Some(local.clone())
                    } else {
                        Some(remote.clone())
                    }
                } else if compare_timestamp_and_device(
                    &local.updated_at,
                    &local.updated_by_device_id,
                    &remote.updated_at,
                    &remote.updated_by_device_id,
                ) == Ordering::Greater
                {
                    Some(local.clone())
                } else {
                    Some(remote.clone())
                }
            }
            (Some(local), None) => Some(local.clone()),
            (None, Some(remote)) => Some(remote.clone()),
            (None, None) => None,
        },
    }
}

fn merge_profile(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> SnapshotProfile {
    let base_profile = base.map(|snapshot| &snapshot.profile);
    let local_changed = base_profile != Some(&local.profile);
    let remote_changed = base_profile != Some(&remote.profile);

    match (local_changed, remote_changed) {
        (false, false) => base_profile
            .cloned()
            .unwrap_or_else(|| local.profile.clone()),
        (true, false) => local.profile.clone(),
        (false, true) => remote.profile.clone(),
        (true, true) => {
            if local.profile.profile_name == remote.profile.profile_name {
                if compare_timestamp_and_device(
                    &local.profile.updated_at,
                    "",
                    &remote.profile.updated_at,
                    "",
                ) == Ordering::Greater
                {
                    local.profile.clone()
                } else {
                    remote.profile.clone()
                }
            } else if compare_timestamp_and_device(
                &local.profile.updated_at,
                "",
                &remote.profile.updated_at,
                "",
            ) == Ordering::Greater
            {
                local.profile.clone()
            } else {
                remote.profile.clone()
            }
        }
    }
}

fn merge_profile_picture(
    base: Option<&SyncSnapshot>,
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
) -> (Option<SnapshotProfilePicture>, Option<SyncConflict>) {
    let base_picture = base.and_then(|snapshot| snapshot.profile_picture.as_ref());
    let local_picture = local.profile_picture.as_ref();
    let remote_picture = remote.profile_picture.as_ref();

    let local_changed = local_picture != base_picture;
    let remote_changed = remote_picture != base_picture;

    match (local_changed, remote_changed) {
        (false, false) => (base_picture.cloned(), None),
        (true, false) => (local_picture.cloned(), None),
        (false, true) => (remote_picture.cloned(), None),
        (true, true) => {
            if local_picture == remote_picture {
                (local_picture.cloned(), None)
            } else {
                (
                    local_picture.cloned(),
                    Some(SyncConflict::ProfilePictureConflict {
                        base_picture: Box::new(base_picture.cloned()),
                        local_picture: Box::new(local_picture.cloned()),
                        remote_picture: Box::new(remote_picture.cloned()),
                    }),
                )
            }
        }
    }
}

fn compare_timestamp_and_device(
    left_timestamp: &str,
    left_device_id: &str,
    right_timestamp: &str,
    right_device_id: &str,
) -> Ordering {
    left_timestamp
        .cmp(right_timestamp)
        .then_with(|| left_device_id.cmp(right_device_id))
}

fn media_content_eq_ignoring_meta(
    left: &SnapshotMediaAggregate,
    right: &SnapshotMediaAggregate,
) -> bool {
    left.uid == right.uid
        && left.title == right.title
        && left.media_type == right.media_type
        && left.status == right.status
        && left.language == right.language
        && left.description == right.description
        && left.content_type == right.content_type
        && left.tracking_status == right.tracking_status
        && left.extra_data == right.extra_data
        && left.cover_blob_sha256 == right.cover_blob_sha256
        && left.activities == right.activities
        && left.milestones == right.milestones
}

fn activity_sort(left: &SnapshotActivity, right: &SnapshotActivity) -> Ordering {
    left.date
        .cmp(&right.date)
        .then_with(|| left.activity_type.cmp(&right.activity_type))
        .then_with(|| left.duration_minutes.cmp(&right.duration_minutes))
        .then_with(|| left.characters.cmp(&right.characters))
}

fn milestone_sort(left: &SnapshotMilestone, right: &SnapshotMilestone) -> Ordering {
    left.date
        .cmp(&right.date)
        .then_with(|| left.name.cmp(&right.name))
        .then_with(|| left.duration.cmp(&right.duration))
        .then_with(|| left.characters.cmp(&right.characters))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_snapshot::{
        SnapshotActivity, SnapshotMediaAggregate, SnapshotMilestone, SnapshotProfile,
        SnapshotProfilePicture, SnapshotSettingValue, SyncSnapshot,
    };

    fn empty_snapshot() -> SyncSnapshot {
        SyncSnapshot {
            sync_protocol_version: SYNC_PROTOCOL_VERSION,
            db_schema_version: db::CURRENT_SCHEMA_VERSION,
            snapshot_id: "snap".to_string(),
            created_at: "2026-04-02T00:00:00Z".to_string(),
            created_by_device_id: "dev_local".to_string(),
            profile: SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-04-01T00:00:00Z".to_string(),
            },
            library: BTreeMap::new(),
            settings: BTreeMap::new(),
            profile_picture: None,
            tombstones: Vec::new(),
        }
    }

    fn media(uid: &str) -> SnapshotMediaAggregate {
        SnapshotMediaAggregate {
            uid: uid.to_string(),
            title: format!("Title {}", uid),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
            extra_data: "{}".to_string(),
            cover_blob_sha256: None,
            updated_at: "2026-04-01T00:00:00Z".to_string(),
            updated_by_device_id: "dev_base".to_string(),
            activities: Vec::new(),
            milestones: Vec::new(),
        }
    }

    fn activity(date: &str, kind: &str, minutes: i64, chars: i64) -> SnapshotActivity {
        SnapshotActivity {
            date: date.to_string(),
            activity_type: kind.to_string(),
            duration_minutes: minutes,
            characters: chars,
        }
    }

    fn milestone(name: &str, duration: i64, chars: i64, date: Option<&str>) -> SnapshotMilestone {
        SnapshotMilestone {
            name: name.to_string(),
            duration,
            characters: chars,
            date: date.map(ToString::to_string),
        }
    }

    fn setting(value: &str, updated_at: &str, device: &str) -> SnapshotSettingValue {
        SnapshotSettingValue {
            value: value.to_string(),
            updated_at: updated_at.to_string(),
            updated_by_device_id: device.to_string(),
        }
    }

    fn picture(label: &str, updated_at: &str, device: &str) -> SnapshotProfilePicture {
        SnapshotProfilePicture {
            mime_type: "image/png".to_string(),
            base64_data: label.to_string(),
            byte_size: label.len() as i64,
            width: 32,
            height: 32,
            updated_at: updated_at.to_string(),
            updated_by_device_id: device.to_string(),
        }
    }

    #[test]
    fn test_merge_local_only_media_create() {
        let base = empty_snapshot();
        let mut local = empty_snapshot();
        let remote = empty_snapshot();

        local.library.insert("uid-1".to_string(), media("uid-1"));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert!(outcome.merged_snapshot.library.contains_key("uid-1"));
    }

    #[test]
    fn test_merge_remote_only_media_create() {
        let base = empty_snapshot();
        let local = empty_snapshot();
        let mut remote = empty_snapshot();

        remote.library.insert("uid-1".to_string(), media("uid-1"));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert!(outcome.merged_snapshot.library.contains_key("uid-1"));
    }

    #[test]
    fn test_merge_local_only_activity_addition() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);
        local
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(activity("2026-04-02", "Reading", 30, 100));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(
            outcome.merged_snapshot.library["uid-1"].activities,
            vec![activity("2026-04-02", "Reading", 30, 100)]
        );
    }

    #[test]
    fn test_merge_remote_only_activity_addition() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);
        remote
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(activity("2026-04-03", "Reading", 45, 120));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(
            outcome.merged_snapshot.library["uid-1"].activities,
            vec![activity("2026-04-03", "Reading", 45, 120)]
        );
    }

    #[test]
    fn test_merge_local_and_remote_different_activities_both_survive() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        local
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(activity("2026-04-02", "Reading", 30, 100));
        remote
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(activity("2026-04-03", "Reading", 45, 200));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(outcome.merged_snapshot.library["uid-1"].activities.len(), 2);
    }

    #[test]
    fn test_merge_identical_activity_additions_are_deduplicated() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let mut base_media = media("uid-1");
        base_media
            .activities
            .push(activity("2026-04-01", "Reading", 10, 0));

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        let duplicate = activity("2026-04-02", "Reading", 60, 5000);
        local
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(duplicate.clone());
        remote
            .library
            .get_mut("uid-1")
            .unwrap()
            .activities
            .push(duplicate);

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(outcome.merged_snapshot.library["uid-1"].activities.len(), 2);
    }

    #[test]
    fn test_merge_local_and_remote_milestones_follow_set_arithmetic() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        local
            .library
            .get_mut("uid-1")
            .unwrap()
            .milestones
            .push(milestone("Arc 1", 120, 0, Some("2026-04-02")));
        remote
            .library
            .get_mut("uid-1")
            .unwrap()
            .milestones
            .push(milestone("Arc 2", 140, 0, Some("2026-04-03")));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(outcome.merged_snapshot.library["uid-1"].milestones.len(), 2);
    }

    #[test]
    fn test_merge_local_only_milestone_addition() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);
        local
            .library
            .get_mut("uid-1")
            .unwrap()
            .milestones
            .push(milestone("Local Arc", 90, 0, Some("2026-04-02")));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(outcome.merged_snapshot.library["uid-1"].milestones.len(), 1);
        assert_eq!(
            outcome.merged_snapshot.library["uid-1"].milestones[0].name,
            "Local Arc"
        );
    }

    #[test]
    fn test_merge_remote_only_milestone_addition() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);
        remote
            .library
            .get_mut("uid-1")
            .unwrap()
            .milestones
            .push(milestone("Remote Arc", 120, 0, Some("2026-04-03")));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        assert_eq!(outcome.merged_snapshot.library["uid-1"].milestones.len(), 1);
        assert_eq!(
            outcome.merged_snapshot.library["uid-1"].milestones[0].name,
            "Remote Arc"
        );
    }

    #[test]
    fn test_merge_non_overlapping_media_field_changes_auto_merge() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        local.library.get_mut("uid-1").unwrap().description = "Local desc".to_string();
        remote.library.get_mut("uid-1").unwrap().tracking_status = "Complete".to_string();

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 0);
        let merged = &outcome.merged_snapshot.library["uid-1"];
        assert_eq!(merged.description, "Local desc");
        assert_eq!(merged.tracking_status, "Complete");
    }

    #[test]
    fn test_merge_same_field_media_conflict_is_queued() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        local.library.get_mut("uid-1").unwrap().description = "Local".to_string();
        remote.library.get_mut("uid-1").unwrap().description = "Remote".to_string();

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 1);
        assert!(matches!(
            &outcome.conflicts[0],
            SyncConflict::MediaFieldConflict { field_name, .. } if field_name == "description"
        ));
        assert_eq!(
            outcome.merged_snapshot.library["uid-1"].description,
            "Local"
        );
    }

    #[test]
    fn test_merge_outcome_can_publish_without_conflicts() {
        let base = empty_snapshot();
        let mut local = empty_snapshot();
        let remote = empty_snapshot();

        local.library.insert("uid-1".to_string(), media("uid-1"));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(outcome.can_publish());
    }

    #[test]
    fn test_merge_outcome_blocks_publish_when_conflicts_exist() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local
            .library
            .insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);

        local.library.get_mut("uid-1").unwrap().description = "Local".to_string();
        remote.library.get_mut("uid-1").unwrap().description = "Remote".to_string();

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(!outcome.can_publish());
    }

    #[test]
    fn test_merge_delete_vs_update_conflict_detection() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        remote
            .library
            .insert("uid-1".to_string(), base_media.clone());
        local.tombstones.push(SnapshotTombstone {
            media_uid: "uid-1".to_string(),
            deleted_at: "2026-04-03T00:00:00Z".to_string(),
            deleted_by_device_id: "dev_local".to_string(),
        });

        remote.library.get_mut("uid-1").unwrap().description = "Changed remotely".to_string();

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 1);
        assert!(matches!(
            &outcome.conflicts[0],
            SyncConflict::DeleteVsUpdate {
                deleted_side: MergeSide::Local,
                ..
            }
        ));
        assert!(!outcome.merged_snapshot.library.contains_key("uid-1"));
        assert_eq!(outcome.merged_snapshot.tombstones.len(), 1);
    }

    #[test]
    fn test_merge_local_deleted_remote_unchanged_accepts_deletion() {
        let mut base = empty_snapshot();
        let local = empty_snapshot();
        let mut remote = empty_snapshot();
        let mut local = local;
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        remote.library.insert("uid-1".to_string(), base_media);
        local.tombstones.push(SnapshotTombstone {
            media_uid: "uid-1".to_string(),
            deleted_at: "2026-04-03T00:00:00Z".to_string(),
            deleted_by_device_id: "dev_local".to_string(),
        });

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(outcome.conflicts.is_empty());
        assert!(!outcome.merged_snapshot.library.contains_key("uid-1"));
        assert_eq!(outcome.merged_snapshot.tombstones.len(), 1);
    }

    #[test]
    fn test_merge_remote_deleted_local_unchanged_accepts_deletion() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let remote = empty_snapshot();
        let mut remote = remote;
        let base_media = media("uid-1");

        base.library.insert("uid-1".to_string(), base_media.clone());
        local.library.insert("uid-1".to_string(), base_media);
        remote.tombstones.push(SnapshotTombstone {
            media_uid: "uid-1".to_string(),
            deleted_at: "2026-04-03T00:00:00Z".to_string(),
            deleted_by_device_id: "dev_remote".to_string(),
        });

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(outcome.conflicts.is_empty());
        assert!(!outcome.merged_snapshot.library.contains_key("uid-1"));
        assert_eq!(outcome.merged_snapshot.tombstones.len(), 1);
    }

    #[test]
    fn test_merge_activity_removal_on_one_side_is_applied() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let mut base_media = media("uid-1");
        base_media
            .activities
            .push(activity("2026-04-01", "Reading", 10, 0));

        base.library.insert("uid-1".to_string(), base_media.clone());
        local.library.insert("uid-1".to_string(), media("uid-1"));
        remote.library.insert("uid-1".to_string(), base_media);

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(outcome.conflicts.is_empty());
        assert!(outcome.merged_snapshot.library["uid-1"]
            .activities
            .is_empty());
    }

    #[test]
    fn test_merge_milestone_removal_on_one_side_is_applied() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();
        let mut base_media = media("uid-1");
        base_media
            .milestones
            .push(milestone("Checkpoint", 20, 0, Some("2026-04-01")));

        base.library.insert("uid-1".to_string(), base_media.clone());
        local.library.insert("uid-1".to_string(), media("uid-1"));
        remote.library.insert("uid-1".to_string(), base_media);

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert!(outcome.conflicts.is_empty());
        assert!(outcome.merged_snapshot.library["uid-1"]
            .milestones
            .is_empty());
    }

    #[test]
    fn test_merge_settings_uses_lww() {
        let base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();

        local.settings.insert(
            "theme".to_string(),
            setting("molokai", "2026-04-01T09:00:00Z", "dev_local"),
        );
        remote.settings.insert(
            "theme".to_string(),
            setting("deep-blue", "2026-04-01T10:00:00Z", "dev_remote"),
        );

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.merged_snapshot.settings["theme"].value, "deep-blue");
        assert_eq!(
            outcome.merged_snapshot.settings["theme"].updated_by_device_id,
            "dev_remote"
        );
    }

    #[test]
    fn test_merge_profile_name_uses_lww() {
        let base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();

        local.profile.profile_name = "Local Name".to_string();
        local.profile.updated_at = "2026-04-01T09:00:00Z".to_string();
        remote.profile.profile_name = "Remote Name".to_string();
        remote.profile.updated_at = "2026-04-01T10:00:00Z".to_string();

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.merged_snapshot.profile.profile_name, "Remote Name");
        assert_eq!(
            outcome.merged_snapshot.profile.updated_at,
            "2026-04-01T10:00:00Z"
        );
    }

    #[test]
    fn test_merge_profile_picture_conflict_is_queued() {
        let mut base = empty_snapshot();
        let mut local = empty_snapshot();
        let mut remote = empty_snapshot();

        base.profile_picture = Some(picture("base", "2026-04-01T00:00:00Z", "dev_base"));
        local.profile_picture = Some(picture("local", "2026-04-02T00:00:00Z", "dev_local"));
        remote.profile_picture = Some(picture("remote", "2026-04-03T00:00:00Z", "dev_remote"));

        let outcome = merge_snapshots(Some(&base), &local, &remote).unwrap();
        assert_eq!(outcome.conflicts.len(), 1);
        assert!(matches!(
            &outcome.conflicts[0],
            SyncConflict::ProfilePictureConflict { .. }
        ));
        assert_eq!(
            outcome
                .merged_snapshot
                .profile_picture
                .as_ref()
                .unwrap()
                .base64_data,
            "local"
        );
    }
}

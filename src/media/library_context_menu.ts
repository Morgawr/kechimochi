import { Media, getLogsForMedia } from '../api';
import { openPopupMenu, type PopupMenuHandle, type PopupMenuItem } from '../popup_menu';
import { BOX, CHECKMARK, FLAG, PLUS, TRASH_CAN } from '../icons';
import {
    addLogForMedia,
    addMilestoneForMedia,
    canAddMilestone,
    canMarkComplete,
    deleteMediaWithConfirmation,
    markMediaComplete,
    toggleMediaArchived,
    type MediaActionOutcome,
} from './media_actions';
import { MEDIA_STATUS } from '../constants';
import { Logger } from '../logger';

type LibraryContextMenuActionId = 'addLog' | 'addMilestone' | 'markComplete' | 'toggleArchive' | 'delete';

interface LibraryContextMenuActionConfig {
    id: LibraryContextMenuActionId;
    label: string;
    iconMarkup: string;
    isDanger?: boolean;
    separatorBefore?: boolean;
    run: (media: Media) => Promise<MediaActionOutcome>;
}

async function addMilestoneFromLibrary(media: Media): Promise<MediaActionOutcome> {
    const logs = media.id == null ? [] : await getLogsForMedia(media.id);
    return addMilestoneForMedia(media, logs);
}

function buildActionConfigs(media: Media): LibraryContextMenuActionConfig[] {
    const addMilestone: LibraryContextMenuActionConfig[] = canAddMilestone(media)
        ? [{ id: 'addMilestone', label: 'Add milestone', iconMarkup: FLAG, run: addMilestoneFromLibrary }]
        : [];
    const markComplete: LibraryContextMenuActionConfig[] = canMarkComplete(media)
        ? [{ id: 'markComplete', label: 'Mark complete', iconMarkup: CHECKMARK, run: markMediaComplete }]
        : [];

    return [
        { id: 'addLog', label: 'Add log', iconMarkup: PLUS, run: addLogForMedia },
        ...addMilestone,
        ...markComplete,
        {
            id: 'toggleArchive',
            label: media.status === MEDIA_STATUS.ARCHIVED ? 'Unarchive' : 'Archive',
            iconMarkup: BOX,
            run: toggleMediaArchived,
        },
        {
            id: 'delete',
            label: 'Delete',
            iconMarkup: TRASH_CAN,
            isDanger: true,
            separatorBefore: true,
            run: deleteMediaWithConfirmation,
        },
    ];
}

interface LibraryContextMenuOptions {
    media: Media;
    clientX: number;
    clientY: number;
    onActionCommitted: () => void;
}

export function openLibraryContextMenu(options: LibraryContextMenuOptions): PopupMenuHandle {
    const { media, clientX, clientY, onActionCommitted } = options;

    const runAction = (run: (media: Media) => Promise<MediaActionOutcome>) => {
        run(media)
            .then(outcome => {
                if (outcome.committed) onActionCommitted();
            })
            .catch(error => Logger.error('Failed to complete a library context menu action', error));
    };

    const items: PopupMenuItem[] = buildActionConfigs(media).map(config => ({
        actionId: config.id,
        label: config.label,
        iconMarkup: config.iconMarkup,
        isDanger: config.isDanger,
        separatorBefore: config.separatorBefore,
        onSelect: () => runAction(config.run),
    }));

    return openPopupMenu({
        label: `Actions for ${media.title}`,
        anchor: { kind: 'point', clientX, clientY },
        items,
    });
}

interface LibraryBackgroundMenuOptions {
    clientX: number;
    clientY: number;
    onCreateMedia: () => void;
}

export function openLibraryBackgroundMenu(options: LibraryBackgroundMenuOptions): PopupMenuHandle {
    const { clientX, clientY, onCreateMedia } = options;

    return openPopupMenu({
        label: 'Library actions',
        anchor: { kind: 'point', clientX, clientY },
        items: [{
            actionId: 'newMedia',
            label: 'New media',
            iconMarkup: PLUS,
            onSelect: onCreateMedia,
        }],
    });
}

import type { CategorySlice, ReportCardDimension } from './report_card_data';
import { formatDurationHm } from './report_card_data';
import { loadChartConstructor } from '../../chart_loader';
import { logPerformance, measureSynchronous, performanceNow } from '../../performance';

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_WIDTH = 600;
const CARD_HEIGHT = 340;
const RENDER_SCALE = 2;

const DONUT_SIZE = 130;
const DONUT_X = 430;
const DONUT_Y = 95;

const AVATAR_RADIUS = 36;
const AVATAR_CENTER_X = 70;
const AVATAR_CENTER_Y = 80;

// ── Exported types ────────────────────────────────────────────────────────────

export interface ReportCardThemeColors {
    backgroundColor: string;
    cardBackgroundColor: string;
    primaryTextColor: string;
    secondaryTextColor: string;
    borderColor: string;
    chartColors: string[]; // --chart-1 until --chart-5 for current style from CSS file, with fallbacks
}

export interface ReportCardImageOptions {
    profileName: string;
    profilePictureDataUrl: string | null;
    initials: string;
    subtitle: string;
    slices: CategorySlice[];
    generatedAtIso: string;
    themeColors: ReportCardThemeColors;
}

// ── Pure helpers ───────────────────────────────────

/**
 * Reads CSS custom properties from the current document theme and returns a
 * typed color bundle used during canvas drawing. Falls back to safe hard-coded
 * defaults so the function is safe even when variables are absent.
 */
export function resolveReportCardThemeColors(): ReportCardThemeColors {
    const style = getComputedStyle(document.body);

    function readVariable(name: string, fallback: string): string {
        const value = style.getPropertyValue(name).trim();
        return value.length > 0 ? value : fallback;
    }

    return {
        backgroundColor: readVariable('--bg-dark', '#1e1e2e'),
        cardBackgroundColor: readVariable('--bg-card', '#2a2a3e'),
        primaryTextColor: readVariable('--text-primary', '#cdd6f4'),
        secondaryTextColor: readVariable('--text-secondary', '#a6adc8'),
        borderColor: readVariable('--border-color', '#45475a'),
        chartColors: [
            readVariable('--chart-1', '#f4a6b8'),
            readVariable('--chart-2', '#b8cdda'),
            readVariable('--chart-3', '#e0bbe4'),
            readVariable('--chart-4', '#957DAD'),
            readVariable('--chart-5', '#D291BC'),
        ],
    };
}

/**
 * Produces a filesystem-safe PNG filename for the report card by sanitizing any
 * characters outside `[A-Za-z0-9_-]` to underscores. The variant distinguishes
 * the activity- and content-breakdown cards.
 */
export function buildReportCardFileName(profileName: string, variant: ReportCardDimension): string {
    const sanitizedProfileName = profileName.replace(/[^A-Za-z0-9_-]/g, '_');
    return `kechimochi_card_${variant}_${sanitizedProfileName}.png`;
}

// ── Internal canvas helpers ───────────────────────────────────────────────────

function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load image'));
        image.src = source;
    });
}

function drawRoundRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.arcTo(x + width, y, x + width, y + radius, radius);
    context.lineTo(x + width, y + height - radius);
    context.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    context.lineTo(x + radius, y + height);
    context.arcTo(x, y + height, x, y + height - radius, radius);
    context.lineTo(x, y + radius);
    context.arcTo(x, y, x + radius, y, radius);
    context.closePath();
}

function drawAvatarFromImage(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    centerX: number,
    centerY: number,
    radius: number,
): void {
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    context.drawImage(image, centerX - radius, centerY - radius, radius * 2, radius * 2);
    context.restore();
}

function drawAvatarFromInitials(
    context: CanvasRenderingContext2D,
    initials: string,
    centerX: number,
    centerY: number,
    radius: number,
    primaryTextColor: string,
    borderColor: string,
): void {
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = borderColor;
    context.fill();
    context.fillStyle = primaryTextColor;
    context.font = `bold ${Math.round(radius * 0.75)}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials, centerX, centerY);
    context.restore();
}

async function drawDonutChart(
    context: CanvasRenderingContext2D,
    slices: CategorySlice[],
    chartColors: string[],
    destinationX: number,
    destinationY: number,
    size: number,
): Promise<void> {
    if (slices.length === 0) return;

    const importStarted = performanceNow();
    const Chart = await loadChartConstructor();
    logPerformance('chart_import', 'report_card_chart_js', performanceNow() - importStarted);

    // Render the chart at the card's physical resolution so it stays crisp when
    // blitted onto the RENDER_SCALE-scaled card context. devicePixelRatio is
    // pinned to 1 so chart.js doesn't apply its own (host-dependent) retina
    // scaling on top, keeping output deterministic across machines.
    const chartCanvas = document.createElement('canvas');
    chartCanvas.width = size * RENDER_SCALE;
    chartCanvas.height = size * RENDER_SCALE;

    const chartInstance = measureSynchronous('chart_construction', 'report_card_donut_chart', () => new Chart(chartCanvas, {
        type: 'doughnut', // chart.js registers this controller under the "doughnut" spelling
        data: {
            labels: slices.map(slice => slice.label),
            datasets: [{
                data: slices.map(slice => slice.minutes),
                backgroundColor: slices.map((_, index) => chartColors[index % chartColors.length]),
                borderWidth: 0,
            }],
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: 1,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
            },
        },
    }));

    context.drawImage(chartCanvas, destinationX, destinationY, size, size);
    chartInstance.destroy();
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Renders the report-card PNG to a Blob. Uses a fixed RENDER_SCALE (not the
 * host devicePixelRatio) so output is deterministic across machines.
 */
export async function renderReportCardImage(options: ReportCardImageOptions): Promise<Blob> {
    const { profileName, profilePictureDataUrl, initials, subtitle, slices, generatedAtIso, themeColors } = options;

    await document.fonts.ready;

    const canvas = document.createElement('canvas');
    canvas.width  = CARD_WIDTH  * RENDER_SCALE;
    canvas.height = CARD_HEIGHT * RENDER_SCALE;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Cannot obtain 2D canvas context for report card rendering');
    }

    context.scale(RENDER_SCALE, RENDER_SCALE);

    // ── Background ────────────────────────────────────────────────────────────
    context.fillStyle = themeColors.backgroundColor;
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // ── Card frame ────────────────────────────────────────────────────────────
    const frameMargin = 16;
    drawRoundRect(context, frameMargin, frameMargin, CARD_WIDTH - frameMargin * 2, CARD_HEIGHT - frameMargin * 2, 12);
    context.fillStyle = themeColors.cardBackgroundColor;
    context.fill();
    context.strokeStyle = themeColors.borderColor;
    context.lineWidth = 1;
    context.stroke();

    // ── Profile picture / initials badge ─────────────────────────────────────
    if (profilePictureDataUrl) {
        try {
            const image = await loadImage(profilePictureDataUrl);
            drawAvatarFromImage(context, image, AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS);
        } catch {
            drawAvatarFromInitials(context, initials, AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS, themeColors.primaryTextColor, themeColors.borderColor);
        }
    } else {
        drawAvatarFromInitials(context, initials, AVATAR_CENTER_X, AVATAR_CENTER_Y, AVATAR_RADIUS, themeColors.primaryTextColor, themeColors.borderColor);
    }

    // ── Username + subtitle ───────────────────────────────────────────────────
    const headerX = AVATAR_CENTER_X + AVATAR_RADIUS + 14;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = themeColors.primaryTextColor;
    context.font = 'bold 20px system-ui, sans-serif';
    context.fillText(profileName, headerX, AVATAR_CENTER_Y - 2);

    context.fillStyle = themeColors.secondaryTextColor;
    context.font = '13px system-ui, sans-serif';
    context.fillText(subtitle, headerX, AVATAR_CENTER_Y + 20);

    // ── Legend rows (swatch + label + duration + percent) ─────────────────────
    const rowStartY = 158;
    const rowHeight = 30;
    const swatchX = 40;
    const swatchRadius = 6;
    const labelX = 60;
    const valueX = 230;

    if (slices.length === 0) {
        context.fillStyle = themeColors.secondaryTextColor;
        context.font = '13px system-ui, sans-serif';
        context.fillText('No activity logged yet.', labelX, rowStartY);
    }

    slices.forEach((slice, index) => {
        const rowY = rowStartY + index * rowHeight;

        // Color swatch matching the donut slice.
        context.beginPath();
        context.arc(swatchX, rowY - 4, swatchRadius, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = themeColors.chartColors[index % themeColors.chartColors.length];
        context.fill();

        // Label (kept in primary text color so it stays legible on every theme).
        context.fillStyle = themeColors.primaryTextColor;
        context.font = '14px system-ui, sans-serif';
        context.textBaseline = 'alphabetic';
        context.fillText(slice.label, labelX, rowY);

        // Duration + percentage share.
        context.fillStyle = themeColors.primaryTextColor;
        context.font = 'bold 14px system-ui, sans-serif';
        context.fillText(formatDurationHm(slice.minutes), valueX, rowY);

        context.fillStyle = themeColors.secondaryTextColor;
        context.font = '12px system-ui, sans-serif';
        context.fillText(`(${slice.percent}%)`, valueX + 90, rowY);
    });

    // ── Donut chart ────────────────────────────────────────────────────────
    await drawDonutChart(context, slices, themeColors.chartColors, DONUT_X, DONUT_Y, DONUT_SIZE);

    // ── App name / branding ───────────────────────────────────────────────────
    context.fillStyle = themeColors.secondaryTextColor;
    context.font = 'bold 11px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('kechimochi', CARD_WIDTH - frameMargin - 80, CARD_HEIGHT - frameMargin - 8);

    // ── Footer: "as of <date>" ────────────────────────────────────────────────
    if (generatedAtIso) {
        const dateLabel = `as of ${new Date(generatedAtIso).toISOString().split('T')[0]}`;
        context.fillStyle = themeColors.secondaryTextColor;
        context.font = '11px system-ui, sans-serif';
        context.textAlign = 'left';
        context.fillText(dateLabel, frameMargin + 20, CARD_HEIGHT - frameMargin - 8);
    }

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            blob => (blob ? resolve(blob) : reject(new Error('Failed to render report card image'))),
            'image/png',
        );
    });
}

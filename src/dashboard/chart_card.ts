import { Component } from '../component';
import { Logger } from '../logger';

export interface ChartCardState {
    hiddenCards?: ReadonlySet<string>;
}

export abstract class ChartCard<TState extends ChartCardState> extends Component<TState> {
    protected renderGeneration = 0;
    protected readonly onCardsRendered: () => void;

    constructor(container: HTMLElement, initialState: TState, onCardsRendered: () => void = () => {}) {
        super(container, initialState);
        this.onCardsRendered = onCardsRendered;
    }

    /** The card's id in `DASHBOARD_CARD_ORDER`, used to read mount intent. */
    protected abstract get cardId(): string;

    /** The canvas this card owns; also how a mounted card is located. */
    protected abstract get canvasId(): string;

    /** Names this card in render-failure logs. */
    protected abstract get chartName(): string;

    protected abstract buildCard(): HTMLElement;

    protected abstract renderChart(card: HTMLElement): Promise<void>;

    /** Runs once per mount, after the card is in the DOM. */
    protected onCardMounted?(card: HTMLElement): void;

    protected getMountedCard(): HTMLElement | null {
        return this.container.querySelector<HTMLElement>(`#${this.canvasId}`)?.closest<HTMLElement>('.card') ?? null;
    }

    protected shouldMount(): boolean {
        return !this.state.hiddenCards?.has(this.cardId);
    }

    public updateHiddenCards(hiddenCards: ReadonlySet<string>): void {
        const previousIntent = this.shouldMount();
        this.state = { ...this.state, hiddenCards };
        if (this.shouldMount() === previousIntent) return;
        this.setState({});
    }

    public setState(newState: Partial<TState>): void {
        this.state = { ...this.state, ...newState };
        const mountedCard = this.getMountedCard();
        if (this.shouldMount() !== Boolean(mountedCard)) {
            this.destroy();
            this.clear();
            this.render();
            return;
        }
        if (!mountedCard) {
            this.render();
            return;
        }

        this.renderChartSafely(mountedCard);
    }

    render(): void {
        const mountedCard = this.getMountedCard();
        if (mountedCard) {
            this.renderChartSafely(mountedCard);
            return;
        }

        this.clear();
        if (!this.shouldMount()) return;

        const card = this.buildCard();
        this.container.appendChild(card);
        this.onCardMounted?.(card);
        this.renderChartSafely(card);
    }

    protected publishRenderComplete(snapshotRequestId: number): void {
        this.container.dataset.dashboardRequestId = snapshotRequestId.toString();
    }

    private renderChartSafely(card: HTMLElement): void {
        this.renderChart(card).catch(error => {
            Logger.error(`Failed to render dashboard ${this.chartName} chart`, error);
        });
    }
}

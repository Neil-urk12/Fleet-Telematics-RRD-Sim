export type GarageView = 'hero' | 'side' | 'rear' | 'top';
export type GarageBody = 'lumen' | 'basalt';

export const BODY_LABEL: Record<GarageBody, string>;
export function bodyFor(model: string): GarageBody;

export interface Garage {
    /** Resolves with one PNG data URL thumbnail per vehicle, in input order. */
    ready: Promise<string[]>;
    /** Lowers the lift, swaps the car, raises it. Ignored while a swap is running. */
    select(index: number): Promise<void>;
    /** Resolves after `ready` with one thumbnail per `catalog` model, in input order. */
    catalogReady: Promise<string[]>;
    /** Swaps the catalog preview for `model` onto the lift, like `select`. */
    preview(model: string): Promise<void>;
    /** Builds a car in the next bay (in its preview's paint, if any) and returns its thumbnail. Call only after `ready`. */
    add(vehicle: { id: string; model: string }): string;
    view(view: GarageView): void;
    setSpin(on: boolean): void;
    dispose(): void;
}

export function createGarage(options: {
    canvas: HTMLCanvasElement;
    /** Element that receives the `--accent` CSS variable for the selected paint. */
    root: HTMLElement;
    vehicles: readonly { id: string; model: string }[];
    /** Model names to build preview cars for (vehicle registration). */
    catalog?: readonly string[];
    startIndex?: number;
    onUserOrbit?: () => void;
    /** Called after each fleet car and catalog preview is built; `total` counts both. */
    onProgress?: (built: number, total: number) => void;
}): Garage;

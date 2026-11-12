import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SimulationAssessment, SimulationRecord, SimulationRequest } from '@fleet/api-client';
import { SimulationResult } from './SimulationResult';

interface AssessmentDetailProps {
    recordId: string;
    loadRecord: (recordId: string) => Promise<SimulationRecord>;
    /** Called once the record has loaded; keep it stable (useCallback), it is an effect dependency. */
    onLoad?: (record: SimulationRecord) => void;
    /** Reruns the saved request against the vehicle's current battery state. */
    onRerun: (request: Required<SimulationRequest>) => void;
    /** Why a rerun is not possible right now; null when it is. */
    rerunBlocked: string | null;
    /** The route-map replay of a saved run, or null when the run is not on the map's route. */
    renderReplay: (assessment: SimulationAssessment) => ReactNode;
}

type LoadResult = { recordId: string } & (
    | { status: 'error'; message: string }
    | { status: 'ready'; record: SimulationRecord });

/** One saved assessment (`#/history/<id>`): its replay on the route map and its full result. */
export function AssessmentDetail({ recordId, loadRecord, onLoad, onRerun, rerunBlocked, renderReplay }: AssessmentDetailProps) {
    const [result, setResult] = useState<LoadResult | null>(null);
    const state = result?.recordId === recordId ? result : null;

    useEffect(() => {
        let cancelled = false;
        loadRecord(recordId).then(
            record => {
                if (cancelled) return;
                setResult({ recordId, status: 'ready', record });
                onLoad?.(record);
            },
            err => {
                if (!cancelled) setResult({
                    recordId, status: 'error',
                    message: err instanceof Error ? err.message : 'Request failed',
                });
            },
        );
        return () => { cancelled = true; };
    }, [recordId, loadRecord, onLoad]);

    const back = <a className="ctrl-btn" href="#/history">← All assessments</a>;
    if (!state || state.status === 'error') {
        return (
            <div className="page-card">
                {back}
                {state
                    ? <p className="assessment-outdated" role="alert">Assessment unavailable: {state.message}</p>
                    : <p role="status">Loading assessment…</p>}
            </div>
        );
    }

    const { record } = state;
    // The backend stores every request field with its default filled in.
    const assessment: SimulationAssessment = {
        request: record.request as Required<SimulationRequest>,
        response: record.response,
        origin: 'backend',
    };
    const replay = renderReplay(assessment);

    return (
        <>
            <div className="page-card sim-result-header">
                {back}
                <p>
                    {record.response.vehicle_id} · saved {new Date(record.timestamp).toLocaleString()}.
                    A rerun uses the vehicle's current battery state and is saved as a new assessment.
                </p>
                <button type="button" className="ctrl-btn ctrl-btn--run" disabled={rerunBlocked !== null}
                    onClick={() => onRerun(assessment.request)}>
                    Rerun with these inputs
                </button>
                {rerunBlocked && <p role="status">{rerunBlocked}</p>}
            </div>
            {replay ?? (
                <p className="page-card assessment-note">
                    Only Manila → Baguio runs can be replayed on the route map.
                </p>
            )}
            <SimulationResult assessment={assessment} isOutdated={false} />
        </>
    );
}

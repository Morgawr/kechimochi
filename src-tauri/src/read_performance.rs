//! Shared timing support for bounded, read-only view queries.
//!
//! Measurements are deliberately observational: they never own cached data and
//! only emit output when `KECHIMOCHI_PERF_LOG=1`. This keeps profiling isolated
//! from normal application behavior and from whichever database is active.

use std::time::{Duration, Instant};

use rusqlite::Result;
use serde::Serialize;

#[derive(Debug)]
pub struct Measured<T> {
    pub value: T,
    pub query_time: Duration,
    pub aggregation_time: Duration,
}

#[derive(Default)]
pub struct Timings {
    query_time: Duration,
    aggregation_time: Duration,
}

impl Timings {
    pub fn query<T>(&mut self, operation: impl FnOnce() -> Result<T>) -> Result<T> {
        let started = Instant::now();
        let result = operation();
        self.query_time += started.elapsed();
        result
    }

    pub fn aggregate<T>(&mut self, operation: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let result = operation();
        self.aggregation_time += started.elapsed();
        result
    }

    pub fn finish<T>(self, value: T) -> Measured<T> {
        Measured {
            value,
            query_time: self.query_time,
            aggregation_time: self.aggregation_time,
        }
    }
}

pub fn log_measured_response<T: Serialize>(operation: &str, measured: &Measured<T>) {
    if std::env::var("KECHIMOCHI_PERF_LOG").as_deref() != Ok("1") {
        return;
    }

    let serialization_started = Instant::now();
    let response_bytes = serde_json::to_vec(&measured.value).map_or(0, |bytes| bytes.len());
    let serialization_ms = serialization_started.elapsed().as_secs_f64() * 1_000.0;
    eprintln!(
        "[kechimochi][perf] operation={operation} query_ms={:.3} aggregation_ms={:.3} serialization_ms={serialization_ms:.3} response_bytes={response_bytes}",
        measured.query_time.as_secs_f64() * 1_000.0,
        measured.aggregation_time.as_secs_f64() * 1_000.0,
    );
}

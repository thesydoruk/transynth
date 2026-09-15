/**
 * Jest setup file: register the game plugins before any test module loads.
 *
 * Production entry points (the API server, the worker, each script) do this
 * themselves; tests import modules directly, so the suite needs one place to
 * do it for them.
 */
import './index';

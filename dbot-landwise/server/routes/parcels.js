import express from 'express';
import * as store from '../dataStore.js';
import { computeArea, computeAvgWidth, computeAvgElevation } from '../landFacts.js';

export const router = express.Router();

router.get('/wards', (req, res) => {
  res.json(store.listWards());
});

router.get('/villages', (req, res) => {
  const { ward } = req.query;
  if (!ward) return res.status(400).json({ error: 'ward query param required' });
  res.json(store.listVillages(ward));
});

router.get('/parcels', (req, res) => {
  const { ward, village } = req.query;
  if (!ward || !village) return res.status(400).json({ error: 'ward and village query params required' });
  res.json(store.listParcels(ward, village));
});

/**
 * The "Location & Land Details" panel's full auto-populated payload —
 * matches the reference screenshot's field set. Zone/DP Zone come from
 * finding the intersecting DP/0 zone feature; everything else that
 * can't be reliably derived comes back null/default, meant to be
 * user-edited in the UI, same pattern as the reference.
 */
router.get('/parcel/:ward/:village/:cts', (req, res) => {
  const { ward, village, cts } = req.params;
  const parcel = store.getParcel(ward, village, decodeURIComponent(cts));
  if (!parcel) return res.status(404).json({ error: 'parcel not found' });

  const hits = store.findIntersecting(parcel);
  const zoneHit = hits.find((h) => h.layer === 'DP_0');
  const islandCityHit = hits.find((h) => h.layer === 'DP_74');

  res.json({
    location: {
      project: 'New Project',
      city: 'Mumbai',
      ward,
      village,
      zone: islandCityHit?.properties?.SUBURB ?? (zoneHit?.properties?.SUBURBS === 'CITY' ? 'Island City' : 'Mumbai Suburban / Extended Suburban'),
      dpZone: zoneHit?.properties?.ZONE_CODE2 ?? null,
      ctsTps: parcel.properties.CTS_CS_NO,
      numPlots: 1,
    },
    land: {
      area: computeArea(parcel),
      avgWidth: computeAvgWidth(parcel),
      avgWidthApproximate: true,
      avgElevation: computeAvgElevation(), // null on purpose — unresolved data gap, editable in UI
      excluded: 0,
      abuttingRoad: null, // editable — banded classification, not yet auto-derived
      ownership: null, // editable — legal fact, not derivable from GIS
      developmentType: null, // editable — Greenfield/Redevelopment, user's call
    },
    geometry: parcel.geometry,
    allIntersectingFeatures: hits, // full raw list, for the Additional Land Details panel later
  });
});

router.get('/stats', (req, res) => {
  res.json(store.stats());
});

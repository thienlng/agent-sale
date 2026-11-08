import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

const PROPERTY = '(select p.name from lodging_properties p where p.id = t.property_id)';
const UNIT = '(select u.name from lodging_units u where u.id = t.unit_id)';
const PACKAGE = '(select k.name from lodging_packages k where k.id = t.package_id)';

/**
 * The lodging module's part of the workspace data export (SET-10): properties, units, packages,
 * rates, bookings (with their units) and night notes. Galleries stay as their JSON folders (not
 * plain URL lists); only the cover photo URL is a media column. Versions, idempotency keys and
 * fingerprints are left out. `lodging_booking_units` has no `id`, so a booking's units are a
 * column of `lodging_bookings.csv`.
 */
export class LodgingExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'lodging_properties.csv',
        table: 'lodging_properties',
        mediaColumns: ['cover_photo', 'gallery'],
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'code', sql: 't.code' },
          { header: 'name', sql: 't.name' },
          { header: 'status', sql: 't.status' },
          { header: 'sell_mode', sql: 't.sell_mode' },
          { header: 'area', sql: 't.area' },
          { header: 'address', sql: 't.address' },
          { header: 'description', sql: 't.description' },
          { header: 'standard_adults', sql: 't.standard_adults' },
          { header: 'standard_children', sql: 't.standard_children' },
          { header: 'max_guests', sql: 't.max_guests' },
          { header: 'child_free_below', sql: 't.child_free_below' },
          { header: 'child_adult_from', sql: 't.child_adult_from' },
          { header: 'extra_adult_sell', sql: 't.extra_adult_sell' },
          { header: 'extra_adult_cost', sql: 't.extra_adult_cost' },
          { header: 'extra_child_sell', sql: 't.extra_child_sell' },
          { header: 'extra_child_cost', sql: 't.extra_child_cost' },
          { header: 'amenities', sql: 't.amenities' },
          { header: 'layout', sql: 't.layout' },
          { header: 'policies', sql: 't.policies' },
          { header: 'gallery', sql: 't.gallery' },
          { header: 'cover_photo', sql: "nullif(t.gallery_cover, '')" },
          { header: 'internal_note', sql: 't.internal_note' },
          { header: 'sort_order', sql: 't.sort_order' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'lodging_units.csv',
        table: 'lodging_units',
        mediaColumns: ['cover_photo', 'gallery'],
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'property_id', sql: 't.property_id' },
          { header: 'property', sql: PROPERTY },
          { header: 'name', sql: 't.name' },
          { header: 'kind', sql: 't.kind' },
          { header: 'category', sql: 't.category' },
          { header: 'active', sql: 't.active' },
          { header: 'beds', sql: 't.beds' },
          { header: 'view', sql: 't.view' },
          { header: 'area_m2', sql: 't.area_m2' },
          { header: 'capacity_adults', sql: 't.capacity_adults' },
          { header: 'capacity_children', sql: 't.capacity_children' },
          { header: 'max_guests', sql: 't.max_guests' },
          { header: 'description', sql: 't.description' },
          { header: 'amenities', sql: 't.amenities' },
          { header: 'gallery', sql: 't.gallery' },
          { header: 'cover_photo', sql: "nullif(t.gallery_cover, '')" },
          { header: 'sort_order', sql: 't.sort_order' },
        ],
      }),
      exportTable(db, id, {
        file: 'lodging_packages.csv',
        table: 'lodging_packages',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'property_id', sql: 't.property_id' },
          { header: 'property', sql: PROPERTY },
          { header: 'unit_id', sql: 't.unit_id' },
          { header: 'unit', sql: UNIT },
          { header: 'name', sql: 't.name' },
          { header: 'bedrooms', sql: 't.bedrooms' },
          { header: 'standard_adults', sql: 't.standard_adults' },
          { header: 'standard_children', sql: 't.standard_children' },
          { header: 'max_guests', sql: 't.max_guests' },
          { header: 'sort_order', sql: 't.sort_order' },
        ],
      }),
      exportTable(db, id, {
        file: 'lodging_rates.csv',
        table: 'lodging_rates',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'property_id', sql: 't.property_id' },
          { header: 'property', sql: PROPERTY },
          { header: 'unit_id', sql: 't.unit_id' },
          { header: 'unit', sql: UNIT },
          { header: 'package_id', sql: 't.package_id' },
          { header: 'package', sql: PACKAGE },
          { header: 'kind', sql: 't.kind' },
          { header: 'label', sql: 't.label' },
          { header: 'weekdays', sql: "array_to_string(t.weekdays, ' ')" },
          { header: 'date_from', sql: 't.date_from::text' },
          { header: 'date_to', sql: 't.date_to::text' },
          { header: 'sell', sql: 't.sell' },
          { header: 'cost', sql: 't.cost' },
          { header: 'min_nights', sql: 't.min_nights' },
        ],
      }),
      exportTable(db, id, {
        file: 'lodging_bookings.csv',
        table: 'lodging_bookings',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'code', sql: 't.code' },
          { header: 'property_id', sql: 't.property_id' },
          { header: 'property', sql: PROPERTY },
          {
            header: 'units',
            sql: `(select string_agg(u.name || coalesce(' (' || k.name || ')', ''), '; ' order by u.sort_order, u.name)
                   from lodging_booking_units b
                   join lodging_units u on u.id = b.unit_id
                   left join lodging_packages k on k.id = b.package_id
                   where b.booking_id = t.id)`,
          },
          { header: 'kind', sql: 't.kind' },
          { header: 'whole', sql: 't.whole' },
          { header: 'status', sql: 't.status' },
          { header: 'check_in', sql: 't.check_in::text' },
          { header: 'check_out', sql: 't.check_out::text' },
          { header: 'adults', sql: 't.adults' },
          { header: 'child_ages', sql: "array_to_string(t.child_ages, ' ')" },
          { header: 'guest_name', sql: 't.guest_name' },
          { header: 'guest_phone', sql: 't.guest_phone' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'conversation_id', sql: 't.conversation_id' },
          { header: 'source', sql: 't.source' },
          { header: 'total_sell', sql: 't.total_sell' },
          { header: 'total_cost', sql: 't.total_cost' },
          { header: 'adjustment', sql: 't.adjustment' },
          { header: 'adjustment_reason', sql: 't.adjustment_reason' },
          { header: 'quote', sql: 't.quote' },
          { header: 'note', sql: 't.note' },
          { header: 'block_reason', sql: 't.block_reason' },
          { header: 'tags', sql: "array_to_string(t.tags, '; ')" },
          { header: 'hold_expires_at', sql: 't.hold_expires_at', time: true },
          { header: 'created_by_user_id', sql: 't.created_by' },
          { header: 'reviewed_by_user_id', sql: 't.reviewed_by' },
          { header: 'reviewed_at', sql: 't.reviewed_at', time: true },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'lodging_night_notes.csv',
        table: 'lodging_night_notes',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'property_id', sql: 't.property_id' },
          { header: 'property', sql: PROPERTY },
          { header: 'unit_id', sql: 't.unit_id' },
          { header: 'unit', sql: UNIT },
          { header: 'night', sql: 't.night::text' },
          { header: 'text', sql: 't.text' },
          { header: 'updated_by_user_id', sql: 't.updated_by' },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
    ];
  }
}

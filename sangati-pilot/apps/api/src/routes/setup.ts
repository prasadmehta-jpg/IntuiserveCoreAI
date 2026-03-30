import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { staffRepo, shiftRepo, zoneAssignmentRepo, venueRepo, zoneRepo } from '@sangati/db';
import type { Staff, Shift, ZoneAssignment } from '@sangati/shared';

export async function setupRoute(app: FastifyInstance): Promise<void> {
  // GET /api/setup/staff?venue_id=
  app.get<{ Querystring: { venue_id?: string } }>(
    '/api/setup/staff',
    async (req, reply) => {
      const staff = req.query.venue_id
        ? staffRepo.findByVenue(req.query.venue_id)
        : staffRepo.findAll();
      return reply.send(staff);
    }
  );

  // POST /api/setup/staff
  app.post<{ Body: Omit<Staff, 'id'> & { id?: string } }>(
    '/api/setup/staff',
    async (req, reply) => {
      const body = req.body;
      if (!body.venue_id || !body.name || !body.role) {
        return reply.status(400).send({ error: 'venue_id, name, role required' });
      }
      // Ensure venue exists
      venueRepo.upsert({ id: body.venue_id, name: body.venue_id });

      const staff: Staff = {
        id:       body.id ?? uuid(),
        venue_id: body.venue_id,
        name:     body.name,
        role:     body.role,
        active:   1,
      };
      staffRepo.upsert(staff);
      return reply.status(201).send(staff);
    }
  );

  // POST /api/setup/shifts
  app.post<{ Body: Omit<Shift, 'id'> & { id?: string } }>(
    '/api/setup/shifts',
    async (req, reply) => {
      const body = req.body;
      if (!body.venue_id || !body.staff_id || !body.starts_at || !body.ends_at) {
        return reply.status(400).send({ error: 'venue_id, staff_id, starts_at, ends_at required' });
      }
      const shift: Shift = {
        id:        body.id ?? uuid(),
        venue_id:  body.venue_id,
        staff_id:  body.staff_id,
        starts_at: body.starts_at,
        ends_at:   body.ends_at,
      };
      shiftRepo.insert(shift);
      return reply.status(201).send(shift);
    }
  );

  // POST /api/setup/zone-assignments
  app.post<{ Body: Omit<ZoneAssignment, 'id'> & { id?: string } }>(
    '/api/setup/zone-assignments',
    async (req, reply) => {
      const body = req.body;
      if (!body.venue_id || !body.zone_id || !body.staff_id || !body.shift_id) {
        return reply.status(400).send({ error: 'venue_id, zone_id, staff_id, shift_id required' });
      }
      // Ensure zone exists
      zoneRepo.upsert({ id: body.zone_id, venue_id: body.venue_id, name: body.zone_id });

      const za: ZoneAssignment = {
        id:       body.id ?? uuid(),
        venue_id: body.venue_id,
        zone_id:  body.zone_id,
        staff_id: body.staff_id,
        shift_id: body.shift_id,
      };
      zoneAssignmentRepo.insert(za);
      return reply.status(201).send(za);
    }
  );

  // GET /api/setup/zone-assignments?venue_id=
  app.get<{ Querystring: { venue_id?: string } }>(
    '/api/setup/zone-assignments',
    async (req, reply) => {
      const zas = req.query.venue_id
        ? zoneAssignmentRepo.findByVenue(req.query.venue_id)
        : [];
      return reply.send(zas);
    }
  );
}

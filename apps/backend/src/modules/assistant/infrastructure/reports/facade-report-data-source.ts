import { CustomerRequestKind } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { COMMERCE_FACADE, type CommerceFacade } from '../../../commerce/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../../conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../../crm/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../../lodging/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../../workspace/api/index.js';
import type {
  AwaitingFigures,
  ContactFigures,
  OrderFigures,
  ReportDataSource,
  RequestFigures,
  RevenueFigures,
  StayFigures,
  StockFigures,
} from '../../domain/ports/report-data-source.port.js';

/** Orders a report lists. */
const LATEST_ORDERS = 5;
/** Low-stock variants read per report (the facade's cap). */
const LOW_STOCK_ITEMS = 20;
/** Waiting conversations fingerprinted per alert (the facade's cap). */
const AWAITING_IDS = 200;

/**
 * Report figures from the owning modules' facades (S3-R1); each read runs in that module's
 * `withTenant`. Nothing here returns customer data.
 */
@Injectable()
export class FacadeReportDataSource implements ReportDataSource {
  constructor(
    @Inject(COMMERCE_FACADE) private readonly commerce: CommerceFacade,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(LODGING_FACADE) private readonly lodging: LodgingFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
  ) {}

  async industry(ws: string): Promise<string> {
    return (await this.workspace.getById(workspaceId(ws))).industry;
  }

  stays(ws: string, from: string, to: string): Promise<StayFigures> {
    return this.lodging.stayRevenue(workspaceId(ws), { from, to });
  }

  async revenue(ws: string, from: string, to: string): Promise<RevenueFigures> {
    const { kpis } = await this.commerce.orderOverview(workspaceId(ws), { from, to });
    return {
      sales: kpis.sales,
      revenue: kpis.revenue,
      closedOrders: kpis.closedOrders,
      averageOrderValue: kpis.avgOrderValue,
      profit: kpis.profit,
    };
  }

  async orders(ws: string, since: Date, until: Date): Promise<OrderFigures> {
    const res = await this.commerce.ordersPlaced(workspaceId(ws), {
      since,
      until,
      limit: LATEST_ORDERS,
    });
    return {
      count: res.count,
      total: res.total,
      latest: res.items.map((o) => ({ code: o.code, total: o.total, placedAt: o.placedAt })),
    };
  }

  async lowStock(ws: string, threshold: number): Promise<StockFigures> {
    const res = await this.commerce.lowStock(workspaceId(ws), {
      threshold,
      limit: LOW_STOCK_ITEMS,
    });
    return {
      count: res.count,
      items: res.items.map((x) => ({ product: x.name, sku: x.sku, available: x.available })),
      ids: res.items.map((x) => x.variantId),
    };
  }

  awaiting(ws: string, olderThan: Date): Promise<AwaitingFigures> {
    return this.conversations.awaitingReply(workspaceId(ws), { olderThan, limit: AWAITING_IDS });
  }

  newContacts(ws: string, since: Date, until: Date): Promise<ContactFigures> {
    return this.crm.contactsCreated(workspaceId(ws), { since, until });
  }

  requests(
    ws: string,
    since: Date,
    until: Date,
    kinds: readonly string[] = [],
  ): Promise<RequestFigures> {
    const known = kinds.flatMap((k) => {
      const kind = CustomerRequestKind.safeParse(k);
      return kind.success ? [kind.data] : [];
    });
    return this.crm.requestsRecorded(workspaceId(ws), { since, until, kinds: known });
  }
}

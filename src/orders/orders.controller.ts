import { Controller, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { PaidOrderDto } from './dto/paid-order.dto';


@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) { }

  @MessagePattern('orders.create')
  async create(@Payload() createOrderDto: CreateOrderDto) {

    try {
      const order = await this.ordersService.create(createOrderDto);
      const paymentSession = await this.ordersService.createPaymentSession(order)

      return {
        order,
        paymentSession,
      }
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: `${error}`
      })
    }


  }

  @MessagePattern('orders.find.all')
  findAll(@Payload() orderPaginationDto: OrderPaginationDto) {
    return this.ordersService.findAll(orderPaginationDto);
  }

  @MessagePattern('orders.find.one')
  findOne(@Payload('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @MessagePattern('orders.change.status')
  changeOrderStatus(@Payload() changeOrderStatusDto: ChangeOrderStatusDto) {
    return this.ordersService.changeStatus(changeOrderStatusDto)

  }

  @EventPattern('payment.succeeded')
  paidOrder(@Payload() paidOrderDto: PaidOrderDto) {
    return this.ordersService.paidOrder(paidOrderDto);
  }

}
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit, Query } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { NATS_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto/paid-order.dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

    constructor(
        @Inject(NATS_SERVICE) private readonly client: ClientProxy
    ) {
        super()
    }

    private readonly logger = new Logger('OrdersService')

    async onModuleInit() {
        await this.$connect();
        this.logger.log('Database connected');
    }

    async create(createOrderDto: CreateOrderDto) {
        try {

            // 1. Confirmar ids de productos
            const productIds = createOrderDto.items.map(items => items.productId);
            const products = await firstValueFrom(
                this.client.send({ cmd: 'validate_products' }, productIds)
            );

            // 2. Cálculo de valores. 
            const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
                // Se obtiene el precio que está en db
                const price = products.find(
                    (product) => product.id === orderItem.productId
                ).price;

                return acc + (price * orderItem.quantity);
            }, 0)

            const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
                return acc + orderItem.quantity;
            }, 0)

            // 3. Crear una transacción de base de datos. Se debe crear la Orden y a la vez crear los items. Si una inserción falla entonces se debe hacer un rollback de la misma.
            // Si fuesen tablas que no tienen relación entre sí se debe ocupar una transacción. En este caso no es necesario ya que se puede crear todo en una misma orden.
            const order = await this.order.create({
                data: {
                    totalAmount: totalAmount,
                    totalItems: totalItems,
                    OrderItem: {
                        createMany: {
                            data: createOrderDto.items.map((OrderItem) => ({
                                price: products.find(product => product.id === OrderItem.productId).price,
                                productId: OrderItem.productId,
                                quantity: OrderItem.quantity
                            }))
                        }
                    }
                },
                include: {
                    OrderItem: {
                        select: {
                            price: true,
                            quantity: true,
                            productId: true,
                        }
                    }
                }
            })

            return {
                ...order,
                OrderItem: order.OrderItem.map((orderItem) => ({
                    ...orderItem,
                    name: products.find(product => product.id === orderItem.productId).name
                }))
            }

        } catch (error) {
            // A modo de no dar mucha info en la respuesta se deja la siguiente
            throw new RpcException({
                status: HttpStatus.BAD_REQUEST,
                message: 'Check logs'
            })
        }
    }

    async findAll(
        @Query() orderPaginationDto: OrderPaginationDto
    ) {
        const totalPages = await this.order.count({
            where: {
                status: orderPaginationDto.status
            }
        })

        const currentPage = orderPaginationDto.page!;
        const perPage = orderPaginationDto.limit!;

        return {
            data: await this.order.findMany({
                skip: (currentPage - 1) * perPage,
                take: perPage,
                where: {
                    status: orderPaginationDto.status
                }
            }),
            meta: {
                total: totalPages,
                page: currentPage,
                lastPage: Math.ceil(totalPages / perPage)
            }
        }
    }

    async findOne(id: string) {
        const order = await this.order.findFirst({
            where: { id },
            include: {
                OrderItem: {
                    select: {
                        productId: true,
                        price: true,
                        quantity: true
                    }
                }
            }
        });

        if (!order) {
            throw new RpcException({
                status: HttpStatus.NOT_FOUND,
                message: `Order with id ${id} not found.`
            })
        }

        const productIds = order.OrderItem.map((item) => item.productId);
        const products = await firstValueFrom(
            this.client.send({ cmd: 'validate_products' }, productIds)
        )

        return {
            ...order,
            OrderItem: order.OrderItem.map(orderItem => ({
                ...orderItem,
                name: products.find(product => product.id === orderItem.productId).name
            })),
        };
    }

    async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
        const { id, status } = changeOrderStatusDto;
        const order = await this.findOne(id);
        if (order.status === status) {
            return order;
        }

        return this.order.update({
            where: { id },
            data: { status }
        })
    }

    async createPaymentSession(order: OrderWithProducts) {
        const paymentSession = await firstValueFrom(
            this.client.send('create.payment.session', {
                orderId: order.id,
                currency: 'usd',
                items: order.OrderItem.map(item => ({
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity
                }))
            })
        )

        return paymentSession;
    }

    async paidOrder(paidOrderDto: PaidOrderDto) {

        const order = await this.order.update({
            where: { id: paidOrderDto.orderId },
            data: {
                status: 'PAID',
                paid: true,
                paidAt: new Date(),
                stripeChargeId: paidOrderDto.stripePaymentId,
                // Se podría hacer una transaction para asegurar que todas las operaciones sean exitosas, pero como se tiene una tabla con una relación (OrderReceipt), se aprovecha eso.
                OrderReceipt: {
                    create: {
                        receiptUrl: paidOrderDto.receiptUrl
                    }
                }
            }
        })

        // Da igual la respuesta, ya que este método se llama a partir de un evento, por lo que no se está esperando una respuesta como tal.
        // Sería importante si hubiera un MessagePattern involucrado
        return order;

    }
}

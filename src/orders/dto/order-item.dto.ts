import { IsMongoId, IsNumber, IsPositive, IsString } from 'class-validator';

export class OrderItemDto {
    @IsString()
    @IsMongoId()
    productId: string;

    @IsNumber()
    @IsPositive()
    quantity: number;

    @IsNumber()
    @IsNumber()
    price: number;
}
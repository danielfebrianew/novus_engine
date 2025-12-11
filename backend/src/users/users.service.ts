import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
    ) { }

    async create(createUserDto: CreateUserDto): Promise<UserDto> {
        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(createUserDto.password, salt);

        const user = this.usersRepository.create({
            ...createUserDto,
            password: hashedPassword,
        });

        const savedUser = await this.usersRepository.save(user);
        return this.toResponseDto(savedUser);
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.usersRepository.findOneBy({ email });
    }

    async findAll(): Promise<UserDto[]> {
        const users = await this.usersRepository.find();
        return users.map((user) => this.toResponseDto(user));
    }

    async findOne(id: number): Promise<UserDto> {
        const user = await this.usersRepository.findOneBy({ id });
        if (!user) throw new NotFoundException(`User with ID ${id} not found`);
        return this.toResponseDto(user);
    }

    async update(id: number, updateUserDto: UpdateUserDto): Promise<UserDto> {
        const user = await this.usersRepository.findOneBy({ id });
        if (!user) throw new NotFoundException(`User with ID ${id} not found`);

        if (updateUserDto.password) {
            const salt = await bcrypt.genSalt();
            updateUserDto.password = await bcrypt.hash(updateUserDto.password, salt);
        }

        const updatedUser = this.usersRepository.merge(user, updateUserDto);
        const savedUser = await this.usersRepository.save(updatedUser);

        return this.toResponseDto(savedUser);
    }

    async remove(id: number): Promise<void> {
        const result = await this.usersRepository.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }
    }

    private toResponseDto(user: User): UserDto {
        return new UserDto({
            id: user.id,
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber,
            referralCode: user.referralCode,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        });
    }
}

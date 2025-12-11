export class UserDto {
  id: number;
  name: string;
  email: string;
  phoneNumber?: string;
  referralCode?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserDto>) {
    Object.assign(this, partial);
  }
}
import {
  LayoutDashboard,
  CreditCard,
  FileText,
  Wallet,
  Package,
  BarChart2,
  Users,
  Tag,
  Percent,
  FileStack,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Reserved for role-based filtering in a future iteration.
   * Leave undefined to show to all roles.
   */
  roles?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/command-center", icon: LayoutDashboard },
  { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { label: "Invoices", href: "/invoices", icon: FileText },
  { label: "Payments", href: "/payments", icon: Wallet },
  { label: "Products", href: "/products", icon: Package },
  { label: "Plans", href: "/plans", icon: BarChart2 },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Discounts", href: "/discounts", icon: Tag },
  { label: "Taxes", href: "/taxes", icon: Percent },
  {
    label: "Quotation Templates",
    href: "/quotation-templates",
    icon: FileStack,
  },
  { label: "Staff", href: "/staff", icon: UserCog },
];

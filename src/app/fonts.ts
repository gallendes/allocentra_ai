// src/app/fonts.ts
import { Montserrat, Roboto_Mono } from "next/font/google";

export const montserrat = Montserrat({
    subsets: ["latin"],
    weight: ['400','500','600','700'],
    variable: '--font-montserrat'
});

export const mono = Roboto_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});
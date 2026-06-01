"use client";

import React from "react";

export interface MDGroupProps {
	children: React.ReactNode;
	className?: string;
}

export function MDGroup({ children, className = "" }: MDGroupProps): JSX.Element {
	return <div className={`md-group ${className}`}>{children}</div>;
}

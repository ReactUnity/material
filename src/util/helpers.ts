import React from 'react';

export function getChildrenOfType(children: React.ReactNode, type: any) {
  return React.Children.toArray(children).filter(
    (x) => x && typeof x === 'object' && 'type' in x && x.type === type,
  ) as React.ReactElement[];
}

export function getOnlyChildOfType(children: React.ReactNode, type: any) {
  return getChildrenOfType(children, type);
}

export function getElevationClass(elevation: number) {
  if (elevation > 0) return `mat-elevation-${elevation}`;
  return 'mat-elevation-0';
}
